/** Confirm a user-verified historical closing choice. Dry-run unless --apply --plan=<hash>. */
import { Client, Databases } from 'node-appwrite';
import dotenv from 'dotenv';
import { createHash } from 'crypto';
import { mkdirSync, writeFileSync } from 'fs';

dotenv.config({ path: '.env.local', quiet: true });
dotenv.config({ path: '.env', quiet: true });
const { DATABASE_ID, COLLECTIONS } = await import('../lib/constants/appwrite');
const arg = (name: string) => process.argv.find(value => value.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
const paymentId = arg('payment');
const expectedAmount = Number(arg('amount'));
const expectedBranch = arg('branch');
if (!paymentId || !expectedBranch || !Number.isFinite(expectedAmount)) throw new Error('Provide --payment, --amount and --branch (branch name).');
const db = new Databases(new Client().setEndpoint(process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT!).setProject(process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID!).setKey(process.env.APPWRITE_API_KEY!));
const doc = await db.getDocument(DATABASE_ID, COLLECTIONS.CLIENT_PAYMENTS, paymentId);
const plan = JSON.parse(doc.paymentPlan);
const updates = JSON.parse(doc.updates);
const branch = await db.getDocument(DATABASE_ID, COLLECTIONS.BRANCHES, plan.closure.branchId);
if (branch.name !== expectedBranch || plan.upfrontAmount !== expectedAmount || !updates.some((u: { amount: number }) => u.amount === expectedAmount)) throw new Error('Expected branch/amount does not match live payment.');
const next = { ...plan, closure: { ...plan.closure, branchSource: 'selected' } };
const hash = createHash('sha256').update(JSON.stringify({ id: doc.$id, updated: doc.$updatedAt, before: plan, after: next })).digest('hex');
console.log(JSON.stringify({ mode: process.argv.includes('--apply') ? 'apply' : 'dry', paymentId, leadId: doc.leadId, amount: expectedAmount, branch: branch.name, diff: { before: plan.closure.branchSource ?? null, after: 'selected' }, plan: hash, amountsAndReceiptsUnchanged: true }, null, 2));
if (process.argv.includes('--apply')) {
  if (arg('plan') !== hash) throw new Error('Plan changed or hash missing; run dry preview again.');
  mkdirSync('outputs', { recursive: true });
  writeFileSync(`outputs/branch-selection-${paymentId}-${Date.now()}.json`, JSON.stringify(doc, null, 2));
  await db.updateDocument(DATABASE_ID, COLLECTIONS.CLIENT_PAYMENTS, paymentId, { paymentPlan: JSON.stringify(next) });
  const verified = await db.getDocument(DATABASE_ID, COLLECTIONS.CLIENT_PAYMENTS, paymentId);
  if (verified.updates !== doc.updates || JSON.parse(verified.paymentPlan).closure.branchSource !== 'selected') throw new Error('Verification failed.');
  console.log('Verified selected branch metadata; all receipts unchanged.');
}
