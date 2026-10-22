import dotenv from 'dotenv';
import { Account, Client, Databases, Query, Users } from 'node-appwrite';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
dotenv.config({ path: '.env.local', quiet: true }); dotenv.config({ path: '.env', quiet: true });

async function main() {
  const email = process.argv.find(arg => arg.startsWith('--email='))?.slice(8).trim();
  if (!email) throw new Error('Provide the authorized recipient with --email=.');
  const apply = process.argv.includes('--apply');
  console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', recipient: email, plan: [
    'Require an existing active Appwrite authentication account with this exact email.',
    'Send one native Appwrite email OTP through configured project SMTP.',
    'Validate the returned provider secret in memory without printing it; remove the temporary verification session.',
    'Delete only security challenge/claim documents created by this probe. No CRM access grant is issued.',
  ] }, null, 2));
  if (!apply) return;
  const { COLLECTIONS, DATABASE_ID } = await import('../lib/constants/appwrite');
  const { issueEmailOtp, consumeEmailOtp } = await import('../lib/server/crm-security-store');
  const client = new Client().setEndpoint(process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT!)
    .setProject(process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID!).setKey(process.env.APPWRITE_API_KEY!);
  const users = await new Users(client).list([Query.equal('email', email), Query.limit(2)]);
  if (users.users.length !== 1 || !users.users[0].status) throw new Error('The authorized recipient needs one active existing Appwrite account.');
  const raw = new Databases(client); const created: string[] = [];
  const db = new Proxy(raw, { get(target, property) {
    if (property === 'createDocument') return async (...args: Parameters<Databases['createDocument']>) => {
      const doc = await target.createDocument(...args); created.push(doc.$id); return doc;
    };
    const value = Reflect.get(target, property); return typeof value === 'function' ? value.bind(target) : value;
  } });
  const original = Account.prototype.createEmailToken;
  let code = ''; let providerAccepted = false;
  Account.prototype.createEmailToken = async function (...args) {
    const token = await original.apply(this, args); code = token.secret; providerAccepted = true; return token;
  };
  const probe = randomUUID();
  try {
    const binding = { userId: `smtp-probe-${probe}`, sessionId: probe, purpose: 'delegate' as const, delegateId: users.users[0].$id };
    const issued = await issueEmailOtp(db, binding, email);
    if (!/^\d{6}$/.test(code)) throw new Error('The provider did not return a usable server-side test secret.');
    await consumeEmailOtp(db, binding, issued.challengeId, code);
    const result = { provider: 'appwrite', providerAccepted, nativeCodeValidated: true, temporarySessionRemoved: true, inboxReceipt: 'Awaiting recipient confirmation' };
    fs.mkdirSync('outputs', { recursive: true });
    fs.writeFileSync('outputs/crm-appwrite-otp-verification.json', JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
  } finally {
    code = ''; Account.prototype.createEmailToken = original;
    for (const id of created) await raw.deleteDocument(DATABASE_ID, COLLECTIONS.SECURITY_CHALLENGES, id);
  }
}
main().catch(error => { console.error('Appwrite SMTP verification stopped.', { code: error.code || 'verification_failed',
  message: error instanceof Error && !(error as { code?: number }).code ? error.message : undefined }); process.exitCode = 1; });
