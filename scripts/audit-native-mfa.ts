import dotenv from 'dotenv';
import { Client, Databases, Query, Users } from 'node-appwrite';
import fs from 'node:fs';

dotenv.config({ path: '.env.local', quiet: true });
dotenv.config({ path: '.env', quiet: true });

/** Read-only preflight. Never enables MFA, verifies email, or changes sessions. */
async function main() {
  const { COLLECTIONS, DATABASE_ID } = await import('../lib/constants/appwrite');
  const client = new Client().setEndpoint(process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT!)
    .setProject(process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID!).setKey(process.env.APPWRITE_API_KEY!);
  const db = new Databases(client); const users = new Users(client);
  const rows = []; let cursor: string | undefined;
  do {
    const page = await db.listDocuments(DATABASE_ID, COLLECTIONS.USERS, [Query.limit(100),
      ...(cursor ? [Query.cursorAfter(cursor)] : [])]);
    for (const profile of page.documents) {
      let native;
      try { native = await users.get(profile.$id); }
      catch (error) {
        if ((error as { code?: number }).code !== 404) throw error;
      }
      const emailMatches = !!native?.email && typeof profile.email === 'string' &&
        native.email.toLowerCase().trim() === profile.email.toLowerCase().trim();
      const active = profile.isActive !== false && native?.status === true;
      rows.push({ id: profile.$id, department: profile.department || 'sales', role: profile.role,
        active, emailMatches, nativeMfa: native?.mfa === true, emailVerified: native?.emailVerification === true,
        nextStep: !native ? 'repair-missing-account' : !active ? 'inactive-no-enrollment' : !emailMatches ? 'repair-email-mismatch'
          : !native.emailVerification ? 'user-verifies-email-then-enrolls' : !native.mfa ? 'user-enrolls-on-next-login' : 'native-mfa-ready' });
    }
    cursor = page.documents.length === 100 ? page.documents.at(-1)!.$id : undefined;
  } while (cursor);
  const counts = Object.fromEntries([...new Set(rows.map(row => row.nextStep))]
    .map(step => [step, rows.filter(row => row.nextStep === step).length]));
  fs.mkdirSync('outputs', { recursive: true });
  const output = `outputs/native-mfa-audit-${Date.now()}.json`;
  fs.writeFileSync(output, JSON.stringify({ mode: 'read-only', database: DATABASE_ID, counts, rows }, null, 2), { flag: 'wx' });
  console.log(JSON.stringify({ mode: 'read-only', database: DATABASE_ID, total: rows.length, counts, output,
    writes: 0, scope: 'Only CRM-mirrored accounts inspected. Appwrite MFA is account-wide: other apps sharing these accounts must support native MFA before enrollment.' }, null, 2));
}
main().catch(() => { console.error('Native MFA preflight failed. Check Appwrite connectivity and read scopes.'); process.exitCode = 1; });
