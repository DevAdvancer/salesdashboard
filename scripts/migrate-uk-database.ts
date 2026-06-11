/**
 * Migrate the UK database schema.
 *
 * Creates all 21 collections, attributes, and indexes in `crm-database`,
 * mirroring the schema of `crm-database-1` (US). This script is the
 * companion to scripts/sync-appwrite-schema.ts and shares the same
 * schema definitions via scripts/lib/schema-definitions.ts.
 *
 * Run:
 *   bun run migrate:uk                # apply changes
 *   bun run migrate:uk -- --dry-run   # preview without writing
 *
 * Required env vars (place in .env.local):
 *   NEXT_PUBLIC_APPWRITE_ENDPOINT=https://cloud.appwrite.io/v1
 *   NEXT_PUBLIC_APPWRITE_PROJECT_ID=your-project-id
 *   APPWRITE_API_KEY=your-server-api-key
 *   NEXT_PUBLIC_APPWRITE_DATABASE_ID_UK=crm-database    (default target)
 *
 * SAFETY: This script is read-only against crm-database-1 (US) and
 * write-only against crm-database (UK). The two databases are kept
 * structurally separate by construction.
 */

import { Client, Databases, IndexType } from 'node-appwrite';
import * as dotenv from 'dotenv';
import * as path from 'path';
import {
  collectionSchemas,
  listCollectionIds,
  SchemaAttr,
  CollectionSchema,
} from './lib/schema-definitions';

// ─── Env loading ────────────────────────────────────────────────────────────

const envPath = path.resolve(process.cwd(), '.env.local');
dotenv.config({ path: envPath });

const ENDPOINT = process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT || 'https://cloud.appwrite.io/v1';
const PROJECT_ID = process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID;
const API_KEY = process.env.APPWRITE_API_KEY;
const TARGET_DATABASE_ID =
  process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID_UK ||
  process.argv
    .find((arg) => arg.startsWith('--target-db='))
    ?.split('=')[1] ||
  'crm-database';

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
  databasesCreated: number;
  collectionsCreated: number;
  collectionsSkipped: number;
  attributesCreated: number;
  attributesSkipped: number;
  indexesCreated: number;
  indexesSkipped: number;
  errors: string[];
};

const stats: Stats = {
  databasesCreated: 0,
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

/**
 * Wait for an attribute to become 'available'. Appwrite creates attributes
 * asynchronously, so a subsequent operation on the same collection may
 * fail with a "not yet available" error if we don't wait.
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
        // Real error, not "not yet created"
        return false;
      }
    }
    await sleep(500);
  }
  return false;
}

// ─── Database setup ─────────────────────────────────────────────────────────

async function ensureDatabase(): Promise<void> {
  console.log('\n🔍 Checking target database...');
  try {
    await databases.get(TARGET_DATABASE_ID);
    console.log(`  ✅ Database ${TARGET_DATABASE_ID} exists`);
  } catch (error) {
    if (isNotFoundError(error)) {
      console.log(`  ➕ Creating database ${TARGET_DATABASE_ID}...`);
      try {
        await databases.create(TARGET_DATABASE_ID, 'UK CRM Database');
        console.log('  ✅ Database created');
        stats.databasesCreated++;
      } catch (createError) {
        const message = getErrorMessage(createError);
        if (message.includes('already exists')) {
          console.log('  ℹ️  Database was created by another process');
        } else {
          throw createError;
        }
      }
    } else {
      throw error;
    }
  }
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
    await databases.createCollection(
      TARGET_DATABASE_ID,
      collectionId,
      collectionId
        .split('_')
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ')
    );
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

// ─── Attribute sync ────────────────────────────────────────────────────────

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
      console.log(`    ⚠️  Skipping ${attr.key}: unsupported type ${attr.type}`);
      return false;
    }
    return true;
  } catch (error) {
    const message = getErrorMessage(error);
    if (message.includes('already exists')) {
      return true; // already created, count as success
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
      // Check if attribute already exists
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

      // Create the attribute
      const created = await createAttribute(collectionId, attr);
      if (!created) {
        continue;
      }

      // Wait for it to become available
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

// ─── Index sync ────────────────────────────────────────────────────────────

async function syncIndexes(
  collectionId: string,
  schema: CollectionSchema
): Promise<void> {
  console.log(`  🔍 Syncing ${schema.indexes.length} indexes...`);

  // Get current indexes
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

// ─── Collection-level sync ──────────────────────────────────────────────────

async function syncCollection(collectionId: string): Promise<void> {
  const schema = collectionSchemas[collectionId];
  if (!schema) {
    console.log(`\n⚠️  No schema defined for collection "${collectionId}", skipping.`);
    return;
  }

  console.log(`\n🔍 Collection: ${collectionId}`);

  const created = await ensureCollection(collectionId);
  if (!created) {
    return; // skip if creation failed
  }

  await syncAttributes(collectionId, schema);
  await syncIndexes(collectionId, schema);
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  console.log(`\n🚀 UK database migration: ${dryRun ? 'DRY RUN (no writes)' : 'APPLY CHANGES'}`);

  // Safety check: refuse to run against the US database
  if (TARGET_DATABASE_ID === 'crm-database-1') {
    console.error('\n❌ SAFETY CHECK FAILED');
    console.error('   Target database is crm-database-1 (the US database).');
    console.error('   This script is for migrating the UK database only.');
    console.error('   Use scripts/sync-appwrite-schema.ts for US schema sync.');
    process.exit(1);
  }

  // Verify connection
  console.log('\n🔌 Verifying Appwrite connection...');
  try {
    const dbs = await databases.list();
    console.log(`✅ Connected. Found ${dbs.total} existing database(s).`);
  } catch (error) {
    console.error('❌ Connection failed:', getErrorMessage(error));
    process.exit(1);
  }

  if (dryRun) {
    console.log('\n📋 DRY RUN — would create the following:');
    console.log(`   - Database: ${TARGET_DATABASE_ID}`);
    console.log(`   - Collections: ${listCollectionIds().length}`);
    const totalAttrs = listCollectionIds().reduce(
      (sum, id) => sum + (collectionSchemas[id]?.attributes.length ?? 0),
      0
    );
    const totalIndexes = listCollectionIds().reduce(
      (sum, id) => sum + (collectionSchemas[id]?.indexes.length ?? 0),
      0
    );
    console.log(`   - Total attributes: ${totalAttrs}`);
    console.log(`   - Total indexes: ${totalIndexes}`);
    console.log('\nRun without --dry-run to apply.');
    return;
  }

  // Ensure database exists
  await ensureDatabase();

  // Sync each collection
  for (const collectionId of listCollectionIds()) {
    await syncCollection(collectionId);
  }

  // Print summary
  console.log('\n' + '═'.repeat(60));
  console.log('📊 MIGRATION SUMMARY');
  console.log('═'.repeat(60));
  console.log(`  Database:           ${TARGET_DATABASE_ID}`);
  console.log(`  Databases created:  ${stats.databasesCreated}`);
  console.log(`  Collections created: ${stats.collectionsCreated}`);
  console.log(`  Collections skipped: ${stats.collectionsSkipped} (already existed)`);
  console.log(`  Attributes created: ${stats.attributesCreated}`);
  console.log(`  Attributes skipped: ${stats.attributesSkipped} (already existed)`);
  console.log(`  Indexes created:    ${stats.indexesCreated}`);
  console.log(`  Indexes skipped:    ${stats.indexesSkipped} (already existed)`);

  if (stats.errors.length > 0) {
    console.log(`\n⚠️  ${stats.errors.length} error(s):`);
    for (const err of stats.errors) {
      console.log(`   - ${err}`);
    }
    console.log('\nMigration completed with errors. Review and re-run if needed.');
    process.exit(1);
  } else {
    console.log('\n🎉 Migration completed successfully!');
    console.log('\nNext steps:');
    console.log('  1. Verify the schema in the Appwrite console');
    console.log('  2. Bootstrap the first UK admin (see docs/11-multi-deployment-architecture.md)');
    console.log('  3. Configure the UK Vercel deployment with NEXT_PUBLIC_APPWRITE_DATABASE_ID=crm-database');
  }
}

main().catch((error) => {
  console.error('\n❌ Migration failed:', error);
  console.error('\nThe script is idempotent — re-running it will pick up where it left off.');
  process.exit(1);
});
