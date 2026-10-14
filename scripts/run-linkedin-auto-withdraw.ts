import { Query } from 'node-appwrite';
import { COLLECTIONS, DATABASE_ID } from '@/lib/constants/appwrite';
import { createAdminClient } from '@/lib/server/appwrite';
import { listAllDocuments } from '@/lib/server/appwrite-pagination';
import { applyLinkedinWithdrawals, listActiveLinkedinRequests,
  planLinkedinWithdrawals, sendLinkedinWithdrawalReport } from '@/lib/server/linkedin-auto-withdraw';
import { getReportEmails } from '@/lib/server/report-email-settings';
import type { User } from '@/lib/types';

const apply = process.argv.includes('--apply');
const now = new Date();
const { databases } = await createAdminClient();
const [requests, users, recipients] = await Promise.all([
  listActiveLinkedinRequests(databases),
  listAllDocuments<User>({ databases, databaseId: DATABASE_ID,
    collectionId: COLLECTIONS.USERS, queries: [Query.select(['$id', 'name', 'isActive'])] }),
  getReportEmails(databases),
]);
const planned = planLinkedinWithdrawals(requests, users, now);

console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', activeRequests: requests.length,
  plannedCount: planned.length, inactiveAgentCount: planned.filter(entry => entry.reason === 'inactive agent').length,
  expiredCount: planned.filter(entry => entry.reason === 'expired request').length,
  settingsRecipientCount: recipients.length,
  sample: planned.slice(0, 12).map(entry => ({ id: entry.request.$id, agent: entry.agentName,
    company: entry.request.company, profile: entry.request.targetUrl, reason: entry.reason,
    fromStatus: entry.request.status, toStatus: 'withdrawn', fromActive: true, toActive: false })),
}, null, 2));

if (apply) {
  const result = await applyLinkedinWithdrawals(databases, planned, now,
    (processed, total) => { if (processed % 500 === 0 || processed === total)
      console.log(JSON.stringify({ processed, total })); });
  const report = await sendLinkedinWithdrawalReport(databases, result.withdrawn, now)
    .catch(error => ({ emailSent: false, recipientCount: recipients.length,
      error: error instanceof Error ? error.message : String(error) }));
  console.log(JSON.stringify({ withdrawn: result.withdrawn.length, errors: result.errors,
    reportEmailSent: report.emailSent, reportRecipientCount: report.recipientCount }, null, 2));
  if (result.errors.length > 0 || (result.withdrawn.length > 0 && recipients.length > 0 && !report.emailSent)) {
    process.exitCode = 1;
  }
}
