/** Read-only check that each created request appears once in LinkedIn Reports. */
import path from 'node:path';
import dotenv from 'dotenv';
import { Client, Databases, Query } from 'node-appwrite';
import { listLinkedinReportRequests } from '../lib/server/linkedin-report-requests';
import { summarizeLinkedinRequests } from '../lib/utils/linkedin-report-summary';
import { getCurrentEasternIsoDate } from '../lib/utils/eastern-date';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local'), quiet: true });
dotenv.config({ path: path.resolve(process.cwd(), '.env'), quiet: true });
const projectId = process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID;
const apiKey = process.env.APPWRITE_API_KEY;
if (!projectId || !apiKey) throw new Error('Appwrite credentials are required.');
const databaseId = process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID || 'crm-database-1';
const usersCollection = process.env.NEXT_PUBLIC_APPWRITE_USERS_COLLECTION_ID || 'users';
const databases = new Databases(new Client()
  .setEndpoint(process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT || 'https://cloud.appwrite.io/v1')
  .setProject(projectId).setKey(apiKey));
async function main() {
const date = process.argv[2] || getCurrentEasternIsoDate();
const teamLeadId = process.argv[3] || null;
const requests = await listLinkedinReportRequests({ databases: databases as never,
  startDate: date, endDate: date, teamLeadId });
const userIds = [...new Set(requests.map(row => row.agentId).filter(Boolean))];
const salesIds = new Set<string>();
for (let index = 0; index < userIds.length; index += 100) {
  const page = await databases.listDocuments(databaseId, usersCollection,
    [Query.equal('$id', userIds.slice(index, index + 100)), Query.limit(100)]);
  for (const user of page.documents) {
    if ((user.department || 'sales') === 'sales') salesIds.add(user.$id);
  }
}
const visible = requests.filter(row => salesIds.has(row.agentId));
const rows = summarizeLinkedinRequests(visible, new Map(), new Set());
const sum = (key: 'sent' | 'accepted' | 'withdrawn' | 'notAccepted') =>
  rows.reduce((total, row) => total + row[key], 0);
const result = { dateEastern: date, teamLeadId, createdRequests: requests.length,
  salesRequests: visible.length, reportRows: rows.length,
  reportCreatedTotal: sum('sent'), accepted: sum('accepted'),
  withdrawn: sum('withdrawn'), notAccepted: sum('notAccepted'),
  omittedNonSalesOrMissingUsers: requests.length - visible.length };
if (result.reportCreatedTotal !== result.salesRequests ||
    result.reportCreatedTotal !== result.accepted + result.withdrawn + result.notAccepted) {
  throw new Error('LinkedIn Report request counts do not reconcile.');
}
console.log(JSON.stringify(result));
}

main().catch(error => { console.error(error); process.exitCode = 1; });
