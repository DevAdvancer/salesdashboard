import dotenv from 'dotenv';
import path from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { Databases, IndexType } from 'node-appwrite';
import { ServerAppwriteClient } from '../lib/server/appwrite-client';

dotenv.config({ path: path.resolve('.env.local'), quiet: true });
dotenv.config({ path: path.resolve('.env'), quiet: true });
const apply = process.argv.includes('--apply');
async function optional<T>(read: () => Promise<T>) {
  try { return await read(); } catch (error) { if ((error as { code?: number }).code === 404) return null; throw error; }
}
async function main() {
  const { COLLECTIONS, DATABASE_ID } = await import('../lib/constants/appwrite');
  const { LEAD_PROFILE_KEY, LEAD_PROFILE_INDEX } = await import('../lib/server/lead-profile-index');
  const { profileIndexPlan } = await import('../lib/server/lead-profile-index-maintenance');
  const db = new Databases(new ServerAppwriteClient().setEndpoint(process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT!)
    .setProject(process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID!).setKey(process.env.APPWRITE_API_KEY!));
  const attribute = await optional(() => db.getAttribute(DATABASE_ID, COLLECTIONS.LINKEDIN_LEAD_REGISTRY, LEAD_PROFILE_KEY));
  const index = await optional(() => db.getIndex(DATABASE_ID, COLLECTIONS.LINKEDIN_LEAD_REGISTRY, LEAD_PROFILE_INDEX));
  const prepared = await profileIndexPlan(db);
  mkdirSync('outputs', { recursive: true });
  const summary = { mode: apply ? 'apply' : 'dry-run', database: DATABASE_ID, collection: COLLECTIONS.LINKEDIN_LEAD_REGISTRY,
    scannedLeads: prepared.scanned, metadataWrites: prepared.writes.length, createAttribute: !attribute, createIndex: !index,
    plan: prepared.plan, leadDocumentWrites: 0, ownerChanges: 0, deletedRecords: 0 };
  writeFileSync('outputs/lead-profile-index-plan.json', JSON.stringify({ ...summary, writes: prepared.writes }, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  if (!apply) return;
  if (!process.argv.includes(`--plan=${prepared.plan}`)) throw new Error('Run dry first and pass its exact --plan hash.');
  if (!attribute) await db.createStringAttribute(DATABASE_ID, COLLECTIONS.LINKEDIN_LEAD_REGISTRY, LEAD_PROFILE_KEY, 34, false, '');
  const waitAvailable = async (load: () => Promise<unknown>) => {
    for (let attempt = 0; attempt < 60; attempt++) {
      const item = await load() as { status?: string };
      if (item.status === 'available') return;
      if (item.status === 'failed' || item.status === 'stuck') throw new Error('Schema did not become available.');
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    throw new Error('Schema is still processing. Retry after checking Appwrite.');
  };
  await waitAvailable(() => db.getAttribute(DATABASE_ID, COLLECTIONS.LINKEDIN_LEAD_REGISTRY, LEAD_PROFILE_KEY));
  if (!index) await db.createIndex(DATABASE_ID, COLLECTIONS.LINKEDIN_LEAD_REGISTRY, LEAD_PROFILE_INDEX, IndexType.Key, [LEAD_PROFILE_KEY]);
  await waitAvailable(() => db.getIndex(DATABASE_ID, COLLECTIONS.LINKEDIN_LEAD_REGISTRY, LEAD_PROFILE_INDEX));
  console.log(JSON.stringify(await prepared.apply()));
}
main().catch(error => { console.error('Lead profile index setup stopped:', error instanceof Error ? error.message : 'Appwrite request failed'); process.exitCode = 1; });
