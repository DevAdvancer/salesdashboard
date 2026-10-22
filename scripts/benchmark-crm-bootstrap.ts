import dotenv from 'dotenv';
import { Account, Client, Databases, Query, Users } from 'node-appwrite';
import fs from 'node:fs';
dotenv.config({ path: '.env.local', quiet: true }); dotenv.config({ path: '.env', quiet: true });
async function main() {
  const apply = process.argv.includes('--apply');
  const email = process.argv.find(arg => arg.startsWith('--email='))?.slice(8);
  if (!email) throw new Error('Specify the authorized developer test email.');
  console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', plan: [
    'Use one temporary session for the authorized existing developer account, only if below the native session limit.',
    'Keep the JWT and signed proof in memory. Compare the old sequential startup with the new single bootstrap on localhost.',
    'Read branch names through the browser gateway and the delegate approval endpoint, then delete only this temporary session. No CRM data writes or OTP sends.',
  ] }, null, 2));
  if (!apply) return;
  const { COLLECTIONS, DATABASE_ID } = await import('../lib/constants/appwrite');
  const { signProof, CRM_PROOF_COOKIE } = await import('../lib/server/crm-security-store');
  const makeClient = () => new Client().setEndpoint(process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT!).setProject(process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID!);
  const admin = makeClient().setKey(process.env.APPWRITE_API_KEY!); const users = new Users(admin); const db = new Databases(admin);
  const people = await users.list([Query.equal('email', email), Query.limit(2)]);
  if (people.users.length !== 1) throw new Error('Expected one existing authorized account.');
  const userId = people.users[0].$id; const user = await db.getDocument(DATABASE_ID, COLLECTIONS.USERS, userId);
  if (!['admin', 'developer'].includes(user.role) || user.isActive === false) throw new Error('Use the authorized active developer account.');
  if ((await users.listSessions(userId)).total >= 8) throw new Error('Probe stopped to avoid evicting any existing sessions.');
  const session = await users.createSession(userId);
  try {
    const account = new Account(makeClient().setSession(session.secret));
    const jwt = await account.createJWT();
    const proof = signProof({ userId, sessionId: session.$id, expiresAt: Math.min(Date.now() + 3600_000, Date.parse(session.expire)) });
    const headers = { cookie: `crm_appwrite_jwt=${jwt.jwt}; ${CRM_PROOF_COOKIE}=${proof}` };
    const get = async (path: string) => {
      const response = await fetch(`http://localhost:5000${path}`, { headers });
      if (!response.ok) throw new Error(`Local probe failed: HTTP ${response.status} at ${path}`);
      return response.json();
    };
    const branches = await get(`/api/appwrite/databases/${DATABASE_ID}/collections/${COLLECTIONS.BRANCHES}/documents?${new URLSearchParams({
      'queries[0]': Query.select(['name', 'isActive']), 'queries[1]': Query.orderDesc('$createdAt'), 'queries[2]': Query.limit(1000),
    })}`);
    if (!Array.isArray(branches.documents) || branches.documents.some((branch: { name?: unknown }) => typeof branch.name !== 'string')) throw new Error('Branch names did not resolve.');
    console.log('Authenticated branch-name lookup passed.');
    const oldStartup = async () => {
      await account.get(); await get('/api/maintenance/status');
      const token = await account.createJWT();
      const sync = await fetch('http://localhost:5000/api/auth/appwrite-session', { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ jwt: token.jwt }) });
      if (!sync.ok) throw new Error('Session sync failed.');
      await get(`/api/appwrite/databases/${DATABASE_ID}/collections/${COLLECTIONS.USERS}/documents/${userId}`);
      await get('/api/security/access');
    };
    const fastStartup = async () => { const result = await get('/api/security/access?view=bootstrap'); if (result.status?.state !== 'allowed') throw new Error('Probe access was not allowed.'); };
    await oldStartup(); await fastStartup(); // Exclude local compilation/cold connections.
    const oldMs = []; const fastMs = [];
    for (let iteration = 0; iteration < 3; iteration++) {
      let start = performance.now(); await oldStartup(); oldMs.push(Math.round(performance.now() - start));
      start = performance.now(); await fastStartup(); fastMs.push(Math.round(performance.now() - start));
    }
    const approvals = await get('/api/security/access?view=approvals');
    const average = (values: number[]) => Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
    const result = { environment: 'Local development server against live Appwrite; warm requests, developer account',
      oldStartupMs: oldMs, fastStartupMs: fastMs, oldAverageMs: average(oldMs), fastAverageMs: average(fastMs),
      improvementPercent: Math.round((1 - average(fastMs) / average(oldMs)) * 100), approvalsReturned: Array.isArray(approvals.requests),
      removedAttendanceRoster: !('attendanceTargets' in approvals) };
    fs.mkdirSync('outputs', { recursive: true }); fs.writeFileSync('outputs/crm-bootstrap-benchmark.json', JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
  } finally { await users.deleteSession(userId, session.$id); }
}
main().catch(error => { console.error('Bootstrap benchmark stopped:', error.code || (error instanceof Error ? error.message : 'probe_failed')); process.exitCode = 1; });
