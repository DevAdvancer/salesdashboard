import dotenv from 'dotenv';
import { createHash, randomUUID } from 'node:crypto';
import { Account, Client, Databases, Query, Users } from 'node-appwrite';
import fs from 'node:fs';
dotenv.config({ path: '.env.local', quiet: true }); dotenv.config({ path: '.env', quiet: true });

async function main() {
  const apply = process.argv.includes('--apply');
  const origin = process.argv.find(arg => arg.startsWith('--origin='))?.slice(9) || 'http://localhost:5000';
  if (!['http://localhost:5000', 'http://localhost:5001'].includes(origin)) throw new Error('This benchmark is restricted to local CRM servers.');
  const email = process.argv.find(arg => arg.startsWith('--email='))?.slice(8);
  if (!email) throw new Error('Specify the authorized developer test email.');
  console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', plan: [
    'Compare read-only lead scans with 100-row and 5,000-row cursor pages against live Appwrite.',
    'Validate the authorized developer, then create an isolated synthetic Sales agent, present-today attendance, a temporary native session and a test LinkedIn account. Existing users and roles stay unchanged.',
    'Record three synthetic, uniquely named test profiles through localhost only. No LinkedIn invitations or emails are sent; no leads are changed.',
    'Delete test requests/history/locks, LinkedIn account, attendance, CRM user and native auth user/session in finally. Keep credentials only in memory.',
  ] }, null, 2));
  if (!apply) return;
  const { COLLECTIONS, DATABASE_ID } = await import('../lib/constants/appwrite');
  const { signProof, CRM_PROOF_COOKIE } = await import('../lib/server/crm-security-store');
  const { getCurrentEasternIsoDate } = await import('../lib/utils/eastern-date');
  const makeClient = () => new Client().setEndpoint(process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT!).setProject(process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID!);
  const admin = makeClient().setKey(process.env.APPWRITE_API_KEY!);
  const db = new Databases(admin); const users = new Users(admin);
  const people = await users.list([Query.equal('email', email), Query.limit(2)]);
  if (people.users.length !== 1) throw new Error('Expected one existing authorized account.');
  const developerId = people.users[0].$id;
  const user = await db.getDocument(DATABASE_ID, COLLECTIONS.USERS, developerId);
  if (!['admin', 'developer'].includes(user.role) || user.isActive === false || (user.department || 'sales') !== 'sales') throw new Error('Use an authorized active Sales developer.');
  const suffix = randomUUID().replaceAll('-', '').slice(0, 16);
  const userId = `speed_user_${suffix}`; const attendanceId = `speed_att_${suffix}`;
  const accountId = `speed_${suffix}`; const company = `CRM speed probe ${suffix}`;
  const urls = Array.from({ length: 3 }, (_, i) => `https://www.linkedin.com/in/crmhub-speed-probe-${suffix}-${i}`);
  const requestIds = urls.map(url => `ext_${createHash('sha256').update(JSON.stringify([company, url])).digest('hex').slice(0, 32)}`);
  let accountCreated = false; let authCreated = false; let userCreated = false; let attendanceCreated = false;
  try {
    const scan = async (limit: number) => {
      let cursor: string | undefined; let count = 0; let calls = 0;
      const started = performance.now();
      for (;;) {
        const page = await db.listDocuments(DATABASE_ID, COLLECTIONS.LEADS, [Query.orderAsc('$id'),
          Query.select(['$id', 'data', 'status', 'ownerId', 'assignedToId', '$updatedAt']), Query.limit(limit), ...(cursor ? [Query.cursorAfter(cursor)] : [])]);
        calls++; count += page.documents.length;
        if (page.documents.length < limit) break;
        cursor = page.documents.at(-1)!.$id;
        if (count >= 100000) throw new Error('Stopped at the lead scan safety limit.');
      }
      return { ms: Math.round(performance.now() - started), calls, count };
    };
    const oldScan = await scan(100); const fastScan = await scan(5000);
    if (oldScan.count !== fastScan.count) throw new Error('Lead count changed during comparison; repeat the probe.');
    const testEmail = `crm-speed-${suffix}@example.invalid`;
    await users.create(userId, testEmail, undefined, randomUUID() + randomUUID(), 'Temporary CRM speed probe');
    authCreated = true;
    await db.createDocument(DATABASE_ID, COLLECTIONS.USERS, userId, {
      name: 'Temporary CRM speed probe', email: testEmail, role: 'agent', department: 'sales', isActive: true,
    }, []);
    userCreated = true;
    await db.createDocument(DATABASE_ID, COLLECTIONS.ATTENDANCE, attendanceId, {
      userId, dateKey: getCurrentEasternIsoDate(), present: true,
    }, []);
    attendanceCreated = true;
    const session = await users.createSession(userId);
    const account = new Account(makeClient().setSession(session.secret));
    const jwt = await account.createJWT();
    const proof = signProof({ userId, sessionId: session.$id, expiresAt: Math.min(Date.now() + 3600_000, Date.parse(session.expire)) });
    await db.createDocument(DATABASE_ID, COLLECTIONS.LINKEDIN_ACCOUNTS, accountId, {
      assignedUserId: userId, teamLeadId: null, company, idName: 'Temporary speed probe', accountType: 'main',
      mainAccountId: null, licenseType: 'free', isActive: true, connectionLimit: 10, createdBy: userId, updatedBy: userId,
    }, []);
    accountCreated = true;
    const call = async (operation: 'check' | 'record', targetUrl: string) => {
      const started = performance.now();
      const response = await fetch(`${origin}/api/extension/linkedin`, { method: 'POST',
        headers: { 'content-type': 'application/json', 'x-crm-extension': 'linkedin-helper-v1', 'sec-fetch-site': 'same-origin',
          origin, cookie: `crm_appwrite_jwt=${jwt.jwt}; ${CRM_PROOF_COOKIE}=${proof}` },
        body: JSON.stringify({ operation, accountId, targetUrl, confirmResend: false }),
      });
      if (!response.ok) throw new Error(`Local extension ${operation} failed: HTTP ${response.status}`);
      const result = await response.json();
      if (operation === 'record' && result.mode !== 'created') throw new Error('Probe did not create exactly one request.');
      return Math.round(performance.now() - started);
    };
    await call('check', urls[0]); // Exclude local route compilation.
    const recordMs: number[] = [];
    for (const url of urls) recordMs.push(await call('record', url));
    const result = { environment: `Warm ${origin} API against live Appwrite; isolated synthetic agent, no LinkedIn sends`,
      oldScan, fastScan, recordMs, averageRecordMs: Math.round(recordMs.reduce((sum, n) => sum + n, 0) / recordMs.length) };
    fs.mkdirSync('outputs', { recursive: true });
    fs.writeFileSync('outputs/linkedin-extension-benchmark.json', JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
  } finally {
    // Raw admin deletes avoid generating another set of history events while cleaning fixtures.
    const cleanupErrors: unknown[] = [];
    const clean = async (operation: () => Promise<unknown>) => {
      try { await operation(); } catch (error) { if ((error as { code?: number }).code !== 404) cleanupErrors.push(error); }
    };
    if (accountCreated) {
      for (const id of requestIds) {
        await clean(() => db.deleteDocument(DATABASE_ID, COLLECTIONS.LINKEDIN_REQUESTS, id));
        await clean(async () => {
          const history = await db.listDocuments(DATABASE_ID, COLLECTIONS.LEAD_HISTORY, [Query.equal('requestId', id), Query.limit(100)]);
          for (const row of history.documents) await clean(() => db.deleteDocument(DATABASE_ID, COLLECTIONS.LEAD_HISTORY, row.$id));
        });
      }
      for (const url of urls) {
        const id = `l_${createHash('sha256').update(url).digest('hex').slice(0, 32)}`;
        await clean(() => db.deleteDocument(DATABASE_ID, COLLECTIONS.LINKEDIN_LEAD_REGISTRY, id));
      }
      await clean(() => db.deleteDocument(DATABASE_ID, COLLECTIONS.LINKEDIN_ACCOUNTS, accountId));
    }
    if (attendanceCreated) await clean(() => db.deleteDocument(DATABASE_ID, COLLECTIONS.ATTENDANCE, attendanceId));
    if (userCreated) await clean(() => db.deleteDocument(DATABASE_ID, COLLECTIONS.USERS, userId));
    if (authCreated) await clean(() => users.delete(userId)); // Deletes the synthetic user's session too.
    if (cleanupErrors.length) throw new Error(`Temporary probe cleanup needs review (${cleanupErrors.length} failures; account ${accountId}, user ${userId}).`);
    console.log('Temporary session and extension fixtures cleaned up.');
  }
}
main().catch(error => { console.error('Extension benchmark stopped:', error.code || (error instanceof Error ? error.message : 'probe_failed')); process.exitCode = 1; });
