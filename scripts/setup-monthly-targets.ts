/**
 * Bootstrap the monthly-target collections in Appwrite.
 *
 * Creates the two collections that the new Target-Report page writes to
 * (admin sets a per-TL team total; TL splits that total across agents):
 *
 *   • monthly_targets              — one document per (team_lead_id, month_key)
 *   • monthly_target_assignments   — one document per (monthly_target_id, agent_id)
 *
 * The schema source-of-truth lives in `scripts/lib/schema-definitions.ts`
 * (the same module that `migrate-uk-database.ts` consumes). This script
 * is intentionally narrow — it only touches the two new collections, so
 * running it against a populated database is safe.
 *
 * Run:
 *   bun run setup:appwrite:targets        # apply changes
 *   bun run setup:appwrite:targets --dry-run   # preview without writing
 *
 * Required env vars (place in .env.local, or .env if .env.local is absent):
 *   NEXT_PUBLIC_APPWRITE_ENDPOINT=https://cloud.appwrite.io/v1
 *   NEXT_PUBLIC_APPWRITE_PROJECT_ID=your-project-id
 *   APPWRITE_API_KEY=your-server-api-key
 *   NEXT_PUBLIC_APPWRITE_DATABASE_ID=crm-database-1   (default)
 */

import { Client, Databases, IndexType } from 'node-appwrite';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { COLLECTIONS, DATABASE_ID as DEFAULT_DATABASE_ID } from '../lib/constants/appwrite';
import {
  collectionSchemas,
  SchemaAttr,
  CollectionSchema,
} from './lib/schema-definitions';

// ─── Env loading ────────────────────────────────────────────────────────────
//
// Load `.env.local` first (Next.js precedence), then fall back to `.env`
// so the script works on machines that only have `.env` checked in.
// `dotenv` silently no-ops when the file is missing.

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
  console.error('   Set them in .env.local and try again.');
  process.exit(1);
}

console.log('Config:', {
  ENDPOINT,
  PROJECT_ID: PROJECT_ID ? PROJECT_ID.substring(0, 4) + '***' : 'MISSING',
  API_KEY: API_KEY ? 'PRESENT' : 'MISSING',
  TARGET_DATABASE_ID,
});

// ─── Client setup ──────────────────────────────────────────────────────────

const client = new Client()
  .setEndpoint(ENDPOINT)
  .setProject(PROJECT_ID)
  .setKey(API_KEY);

const databases = new Databases(client);

// ─── Stats ──────────────────────────────────────────────────────────────────

type Stats = {
  collectionsCreated: number;
  collectionsSkipped: number;
  attributesCreated: number;
  attributesSkipped: number;
  indexesCreated: number;
  indexesSkipped: number;
  errors: string[];
};

const stats: Stats = {
  collectionsCreated: 0,
  collectionsSkipped: 0,
  attributesCreated: 0,
  attributesSkipped: 0,
  indexesCreated: 0,
  indexesSkipped: 0,
  errors: [],
};

// ─── Helpers ────────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function isNotFoundError(error: unknown): boolean {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    return Number((error as { code: unknown }).code) === 404;
  }
  return false;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function humanize(id: string): string {
  return id
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * Wait for an attribute to become 'available'. Appwrite creates attributes
 * asynchronously, so a follow-up operation may fail with a "not yet
 * available" error if we don't wait.
 */
async function waitForAttribute(
  collectionId: string,
  attrKey: string,
  timeoutMs = 30000
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const attr = await databases.getAttribute(TARGET_DATABASE_ID, collectionId, attrKey);
      const status = (attr as unknown as { status: string }).status;
      if (status === 'available') {
        return true;
      }
      if (status === 'failed') {
        return false;
      }
    } catch (error) {
      if (!isNotFoundError(error)) {
        return false;
      }
    }
    await sleep(500);
  }
  return false;
}

// ─── Collection setup ───────────────────────────────────────────────────────

async function ensureCollection(collectionId: string): Promise<boolean> {
  try {
    await databases.getCollection(TARGET_DATABASE_ID, collectionId);
    console.log(`  ⏭️  Collection ${collectionId} already exists`);
    stats.collectionsSkipped++;
    return true;
  } catch (error) {
    if (!isNotFoundError(error)) {
      throw error;
    }
  }

  console.log(`  ➕ Creating collection ${collectionId}...`);
  try {
    await databases.createCollection(TARGET_DATABASE_ID, collectionId, humanize(collectionId));
    console.log('  ✅ Collection created');
    stats.collectionsCreated++;
    return true;
  } catch (createError) {
    const message = getErrorMessage(createError);
    if (message.includes('already exists')) {
      console.log('  ℹ️  Collection was created by another process');
      stats.collectionsSkipped++;
      return true;
    }
    stats.errors.push(`Collection ${collectionId}: ${message}`);
    console.log(`  ❌ ${message}`);
    return false;
  }
}

// ─── Attribute sync ─────────────────────────────────────────────────────────

async function createAttribute(
  collectionId: string,
  attr: SchemaAttr
): Promise<boolean> {
  try {
    if (attr.type === 'string' && attr.size) {
      await databases.createStringAttribute(
        TARGET_DATABASE_ID,
        collectionId,
        attr.key,
        attr.size,
        attr.required ?? false,
        attr.default as string | undefined,
        attr.array ?? false
      );
    } else if (attr.type === 'email') {
      await databases.createEmailAttribute(
        TARGET_DATABASE_ID,
        collectionId,
        attr.key,
        attr.required ?? false,
        attr.default as string | undefined
      );
    } else if (attr.type === 'enum' && attr.values) {
      await databases.createEnumAttribute(
        TARGET_DATABASE_ID,
        collectionId,
        attr.key,
        attr.values,
        attr.required ?? false,
        attr.default as string | undefined
      );
    } else if (attr.type === 'boolean') {
      await databases.createBooleanAttribute(
        TARGET_DATABASE_ID,
        collectionId,
        attr.key,
        attr.required ?? false,
        attr.default as boolean | undefined
      );
    } else if (attr.type === 'datetime') {
      await databases.createDatetimeAttribute(
        TARGET_DATABASE_ID,
        collectionId,
        attr.key,
        attr.required ?? false
      );
    } else if (attr.type === 'integer') {
      await databases.createIntegerAttribute(
        TARGET_DATABASE_ID,
        collectionId,
        attr.key,
        attr.required ?? false,
        attr.min,
        attr.max,
        attr.default as number,
        attr.array ?? false
      );
    } else {
      console.log(`\n    ⚠️  Skipping ${attr.key}: unsupported type ${attr.type}`);
      return false;
    }
    return true;
  } catch (error) {
    const message = getErrorMessage(error);
    if (message.includes('already exists')) {
      return true;
    }
    throw error;
  }
}

async function syncAttributes(
  collectionId: string,
  schema: CollectionSchema
): Promise<void> {
  console.log(`  📋 Syncing ${schema.attributes.length} attributes...`);

  for (const attr of schema.attributes) {
    process.stdout.write(`    ${attr.key}: ${attr.type}${attr.array ? '[]' : ''} `);

    try {
      try {
        await databases.getAttribute(TARGET_DATABASE_ID, collectionId, attr.key);
        console.log('⏭️  (exists)');
        stats.attributesSkipped++;
        continue;
      } catch (error) {
        if (!isNotFoundError(error)) {
          throw error;
        }
      }

      const created = await createAttribute(collectionId, attr);
      if (!created) {
        continue;
      }

      const available = await waitForAttribute(collectionId, attr.key);
      if (available) {
        console.log('✅');
        stats.attributesCreated++;
      } else {
        console.log('⏱️  (timed out waiting for availability, will continue)');
        stats.attributesCreated++;
      }
    } catch (error) {
      const message = getErrorMessage(error);
      console.log(`❌ ${message}`);
      stats.errors.push(`Attribute ${collectionId}.${attr.key}: ${message}`);
    }
  }
}

// ─── Index sync ─────────────────────────────────────────────────────────────

async function syncIndexes(
  collectionId: string,
  schema: CollectionSchema
): Promise<void> {
  console.log(`  🔍 Syncing ${schema.indexes.length} indexes...`);

  let currentIndexes: Array<{ key: string }> = [];
  try {
    const idxsRes = await databases.listIndexes(TARGET_DATABASE_ID, collectionId);
    currentIndexes = idxsRes.indexes as Array<{ key: string }>;
  } catch (error) {
    if (!isNotFoundError(error)) {
      throw error;
    }
  }

  for (const idx of schema.indexes) {
    process.stdout.write(`    ${idx.key}: ${idx.type} on [${idx.attributes.join(', ')}] `);

    if (currentIndexes.some((i) => i.key === idx.key)) {
      console.log('⏭️  (exists)');
      stats.indexesSkipped++;
      continue;
    }

    try {
      await databases.createIndex(
        TARGET_DATABASE_ID,
        collectionId,
        idx.key,
        idx.type as IndexType,
        idx.attributes
      );
      console.log('✅');
      stats.indexesCreated++;
    } catch (error) {
      const message = getErrorMessage(error);
      if (message.includes('already exists')) {
        console.log('⏭️  (exists)');
        stats.indexesSkipped++;
      } else {
        console.log(`❌ ${message}`);
        stats.errors.push(`Index ${collectionId}.${idx.key}: ${message}`);
      }
    }
  }
}

// ─── Per-collection orchestration ───────────────────────────────────────────

async function syncCollection(collectionId: string): Promise<void> {
  const schema = collectionSchemas[collectionId];
  if (!schema) {
    console.log(`\n⚠️  No schema defined for collection "${collectionId}" in scripts/lib/schema-definitions.ts.`);
    console.log(`   Add it there first, then re-run this script.`);
    return;
  }

  console.log(`\n🔍 Collection: ${collectionId}`);

  const created = await ensureCollection(collectionId);
  if (!created) {
    return;
  }

  await syncAttributes(collectionId, schema);
  await syncIndexes(collectionId, schema);
}

// ─── Main ──────────────────────────────────────────────────────────────────

const TARGETS = [COLLECTIONS.MONTHLY_TARGETS, COLLECTIONS.MONTHLY_TARGET_ASSIGNMENTS] as const;

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  console.log(`\n🚀 Monthly-targets setup: ${dryRun ? 'DRY RUN (no writes)' : 'APPLY CHANGES'}`);
  console.log(`   Target database: ${TARGET_DATABASE_ID}`);
  console.log(`   Collections:     ${TARGETS.join(', ')}`);

  // Verify the schema is declared for both collections — fail fast if
  // someone renamed them in lib/constants/appwrite.ts without updating
  // scripts/lib/schema-definitions.ts.
  for (const id of TARGETS) {
    if (!collectionSchemas[id]) {
      console.error(`\n❌ Schema missing for "${id}" in scripts/lib/schema-definitions.ts.`);
      console.error('   Add the collection to that file before running this script.');
      process.exit(1);
    }
  }

  // Verify connection (skip under --dry-run; we never write anything)
  if (!dryRun) {
    console.log('\n🔌 Verifying Appwrite connection...');
    try {
      const dbs = await databases.list();
      console.log(`✅ Connected. Found ${dbs.total} existing database(s).`);
    } catch (error) {
      console.error('❌ Connection failed:', getErrorMessage(error));
      process.exit(1);
    }
  }

  if (dryRun) {
    console.log('\n📋 DRY RUN — would create the following:');
    for (const id of TARGETS) {
      const schema = collectionSchemas[id];
      console.log(`\n   Collection: ${id} (${humanize(id)})`);
      console.log(`     attributes: ${schema.attributes.length}`);
      for (const a of schema.attributes) {
        console.log(`       - ${a.key}: ${a.type}${a.array ? '[]' : ''}${a.required ? ' (required)' : ''}`);
      }
      console.log(`     indexes:    ${schema.indexes.length}`);
      for (const i of schema.indexes) {
        console.log(`       - ${i.key}: ${i.type} on [${i.attributes.join(', ')}]`);
      }
    }
    console.log('\nRun without --dry-run to apply.');
    return;
  }

  for (const id of TARGETS) {
    await syncCollection(id);
  }

  // Summary
  console.log('\n' + '═'.repeat(60));
  console.log('📊 MONTHLY-TARGETS SETUP SUMMARY');
  console.log('═'.repeat(60));
  console.log(`  Database:            ${TARGET_DATABASE_ID}`);
  console.log(`  Collections created: ${stats.collectionsCreated}`);
  console.log(`  Collections skipped: ${stats.collectionsSkipped} (already existed)`);
  console.log(`  Attributes created:  ${stats.attributesCreated}`);
  console.log(`  Attributes skipped:  ${stats.attributesSkipped} (already existed)`);
  console.log(`  Indexes created:     ${stats.indexesCreated}`);
  console.log(`  Indexes skipped:     ${stats.indexesSkipped} (already existed)`);

  if (stats.errors.length > 0) {
    console.log(`\n⚠️  ${stats.errors.length} error(s):`);
    for (const err of stats.errors) {
      console.log(`   - ${err}`);
    }
    console.log('\nSetup completed with errors. The script is idempotent — re-run to retry.');
    process.exit(1);
  } else {
    console.log('\n🎉 Setup completed successfully!');
    console.log('\nNext steps:');
    console.log('  1. Open /target-report in the app — the admin form should now load.');
    console.log('  2. Set a team target for the current month.');
    console.log('  3. Switch to a team_lead account to split it across agents.');
  }
}

main().catch((error) => {
  console.error('\n❌ Setup failed:', error);
  console.error('\nThe script is idempotent — re-running it will pick up where it left off.');
  process.exit(1);
});
