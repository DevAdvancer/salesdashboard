import dotenv from 'dotenv';
import { Client, Databases, Query, Users } from 'node-appwrite';
import fs from 'node:fs';
import { planNativeMfaEnrollment, type MfaEnrollmentAccount } from '../lib/utils/native-mfa-enrollment';

dotenv.config({ path: '.env.local', quiet: true });
dotenv.config({ path: '.env', quiet: true });

/**
 * Turns on Appwrite native MFA for every CRM-mirrored account, all roles.
 *   (default)          dry run: report only, no writes
 *   --apply            write the planned changes
 *   --verify-emails    also mark the email verified where it matches the CRM profile,
 *                      so those users get a code at next sign-in instead of a verification link
 *   --include-inactive also enroll deactivated accounts (they cannot sign in until reactivated)
 * Appwrite MFA is account-wide: every app sharing these accounts (including the UK
 * deployment) must already run a native-MFA login client before --apply.
 * Never changes passwords, roles or sessions.
 */
async function main() {
  const args = new Set(process.argv.slice(2));
  const apply = args.has('--apply');
  const options = { verifyEmails: args.has('--verify-emails'), includeInactive: args.has('--include-inactive') };
  const { COLLECTIONS, DATABASE_ID } = await import('../lib/constants/appwrite');
  const client = new Client().setEndpoint(process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT!)
    .setProject(process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID!).setKey(process.env.APPWRITE_API_KEY!);
  const db = new Databases(client); const users = new Users(client);
  const rows = []; let cursor: string | undefined;
  do {
    const page = await db.listDocuments(DATABASE_ID, COLLECTIONS.USERS, [Query.limit(100),
      ...(cursor ? [Query.cursorAfter(cursor)] : [])]);
    for (const profile of page.documents) {
      let native: MfaEnrollmentAccount | undefined;
      try { native = await users.get(profile.$id); }
      catch (error) { if ((error as { code?: number }).code !== 404) throw error; }
      const plan = planNativeMfaEnrollment({ email: profile.email, isActive: profile.isActive }, native, options);
      const row = { id: profile.$id, role: profile.role, department: profile.department || 'sales', ...plan, applied: false, error: '' };
      if (apply && (plan.enableMfa || plan.verifyEmail)) {
        try {
          if (plan.verifyEmail) await users.updateEmailVerification(profile.$id, true);
          if (plan.enableMfa) await users.updateMfa(profile.$id, true);
          row.applied = true;
        } catch (error) { row.error = error instanceof Error ? error.message : 'Update failed'; }
      }
      rows.push(row);
    }
    cursor = page.documents.length === 100 ? page.documents.at(-1)!.$id : undefined;
  } while (cursor);
  const count = (pick: (row: typeof rows[number]) => boolean) => rows.filter(pick).length;
  const summary = {
    mode: apply ? 'apply' : 'dry-run', database: DATABASE_ID, ...options, total: rows.length,
    enableMfa: count(row => row.enableMfa), verifyEmail: count(row => row.verifyEmail),
    alreadyReady: count(row => row.outcome === 'ready'), needsEmailLink: count(row => row.outcome === 'mfa-on-email-link-at-sign-in'),
    skipped: Object.fromEntries([...new Set(rows.map(row => row.skipped).filter(Boolean))].map(reason => [reason, count(row => row.skipped === reason)])),
    applied: count(row => row.applied), failed: count(row => !!row.error),
  };
  fs.mkdirSync('outputs', { recursive: true });
  const output = `outputs/native-mfa-enable-${summary.mode}-${Date.now()}.json`;
  fs.writeFileSync(output, JSON.stringify({ ...summary, rows }, null, 2), { flag: 'wx' });
  console.log(JSON.stringify({ ...summary, output }, null, 2));
  if (summary.failed) process.exitCode = 1;
}
main().catch(() => { console.error('Native MFA enablement failed. Check Appwrite connectivity and users.write scope.'); process.exitCode = 1; });
