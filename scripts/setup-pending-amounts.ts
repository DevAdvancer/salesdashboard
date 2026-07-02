/**
 * Bootstrap the pending_amounts collection in Appwrite.
 *
 * Run:
 *   bun run setup:pending-amounts           # apply changes
 *   bun run setup:pending-amounts:dry       # preview without writing
 */

import { Client, Databases } from 'node-appwrite';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { COLLECTIONS, DATABASE_ID as DEFAULT_DATABASE_ID } from '../lib/constants/appwrite';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const ENDPOINT = process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT || 'https://cloud.appwrite.io/v1';
const PROJECT_ID = process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID;
const API_KEY = process.env.APPWRITE_API_KEY;
const TARGET_DATABASE_ID = process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID || DEFAULT_DATABASE_ID;

if (!PROJECT_ID || !API_KEY) {
  console.error('❌ Missing required env vars:');
  console.error('   - NEXT_PUBLIC_APPWRITE_PROJECT_ID');
  console.error('   - APPWRITE_API_KEY');
  process.exit(1);
}

const isDryRun = process.argv.includes('--dry-run');

console.log('Config:', {
  ENDPOINT,
  PROJECT_ID: PROJECT_ID.substring(0, 4) + '***',
  TARGET_DATABASE_ID,
  DRY_RUN: isDryRun,
});

const client = new Client()
  .setEndpoint(ENDPOINT)
  .setProject(PROJECT_ID)
  .setKey(API_KEY);

const databases = new Databases(client);

function humanize(id: string): string {
  return id.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitForAttribute(collectionId: string, attrKey: string, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const attr = await databases.getAttribute(TARGET_DATABASE_ID, collectionId, attrKey);
      const status = (attr as any).status;
      if (status === 'available') return true;
      if (status === 'failed') return false;
    } catch {}
    await sleep(500);
  }
  return false;
}

async function main() {
  const collectionId = COLLECTIONS.PENDING_AMOUNTS;
  console.log(`\n⏳ Setting up ${collectionId}...\n`);

  // Check if collection exists
  try {
    await databases.getCollection(TARGET_DATABASE_ID, collectionId);
    console.log(`  ⏭️  Collection ${collectionId} already exists`);
  } catch (error: any) {
    if (error?.code !== 404) throw error;

    console.log(`  ➕ Creating collection ${collectionId}...`);
    if (!isDryRun) {
      await databases.createCollection(TARGET_DATABASE_ID, collectionId, humanize(collectionId));
    }
    console.log('  ✅ Collection created');
  }

  if (isDryRun) {
    console.log('\n🎉 Dry run complete (no changes made)');
    return;
  }

  // Create attributes
  const attrs = [
    { key: 'leadId', type: 'string' as const, size: 255, required: true },
    { key: 'paymentRecordId', type: 'string' as const, size: 255, required: true },
    { key: 'monthKey', type: 'string' as const, size: 7, required: true },
    { key: 'pendingAmount', type: 'integer' as const, required: true, min: 0 },
    { key: 'status', type: 'enum' as const, values: ['pending', 'cleared'], required: true },
    { key: 'createdAt', type: 'datetime' as const, required: true },
    { key: 'updatedAt', type: 'datetime' as const, required: false },
    { key: 'updatedById', type: 'string' as const, size: 255, required: false },
    { key: 'updatedByName', type: 'string' as const, size: 255, required: false },
  ];

  for (const attr of attrs) {
    try {
      await databases.getAttribute(TARGET_DATABASE_ID, collectionId, attr.key);
      console.log(`  ⏭️  Attribute ${attr.key} already exists`);
    } catch (error: any) {
      if (error?.code === 404) {
        console.log(`  ➕ Creating attribute ${attr.key}...`);
        if (attr.type === 'string') {
          await databases.createStringAttribute(TARGET_DATABASE_ID, collectionId, attr.key, attr.size!, attr.required);
        } else if (attr.type === 'integer') {
          await databases.createIntegerAttribute(TARGET_DATABASE_ID, collectionId, attr.key, attr.required, (attr as any).min ?? 0, undefined);
        } else if (attr.type === 'enum' && attr.values) {
          await databases.createEnumAttribute(TARGET_DATABASE_ID, collectionId, attr.key, attr.values, attr.required);
        } else if (attr.type === 'datetime') {
          await databases.createDatetimeAttribute(TARGET_DATABASE_ID, collectionId, attr.key, attr.required);
        }
        await waitForAttribute(collectionId, attr.key);
        console.log(`  ✅ Attribute ${attr.key} created`);
      } else {
        throw error;
      }
    }
  }

  // Create indexes
  const indexes = [
    { key: 'lead_month_unique', type: 'unique' as const, attrs: ['leadId', 'monthKey'] },
    { key: 'lead_idx', type: 'key' as const, attrs: ['leadId'] },
    { key: 'month_idx', type: 'key' as const, attrs: ['monthKey'] },
    { key: 'status_idx', type: 'key' as const, attrs: ['status'] },
    { key: 'payment_record_idx', type: 'key' as const, attrs: ['paymentRecordId'] },
  ];

  for (const idx of indexes) {
    try {
      await databases.getIndex(TARGET_DATABASE_ID, collectionId, idx.key);
      console.log(`  ⏭️  Index ${idx.key} already exists`);
    } catch (error: any) {
      if (error?.code === 404) {
        console.log(`  ➕ Creating index ${idx.key}...`);
        await databases.createIndex(TARGET_DATABASE_ID, collectionId, idx.key, idx.type as any, idx.attrs);
        console.log(`  ✅ Index ${idx.key} created`);
      } else {
        throw error;
      }
    }
  }

  console.log('\n🎉 Setup complete!');
}

main().catch((e) => {
  console.error('\n❌ Setup failed:', e.message);
  process.exit(1);
});
