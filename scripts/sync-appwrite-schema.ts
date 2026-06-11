/**
 * Sync Appwrite schema to match the application code.
 *
 * Run: bun run sync:appwrite
 * Dry-run (read-only): bun run sync:appwrite --dry-run
 */
import { Client, Databases } from 'node-appwrite';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { DATABASE_ID, COLLECTIONS } from '../lib/constants/appwrite';

// Load env vars
const envPath = path.resolve(process.cwd(), '.env.local');
dotenv.config({ path: envPath });

const ENDPOINT = process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT || 'https://cloud.appwrite.io/v1';
const PROJECT_ID = process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID;
const API_KEY = process.env.APPWRITE_API_KEY;

console.log('Config:', {
  ENDPOINT,
  PROJECT_ID: PROJECT_ID ? PROJECT_ID.substring(0, 4) + '***' : 'MISSING',
  API_KEY: API_KEY ? 'PRESENT' : 'MISSING',
  DATABASE_ID,
});

if (!PROJECT_ID || !API_KEY) {
  console.error('Missing Project ID or API Key');
  console.error('Set NEXT_PUBLIC_APPWRITE_PROJECT_ID and APPWRITE_API_KEY in your .env.local');
  process.exit(1);
}

const client = new Client()
  .setEndpoint(ENDPOINT)
  .setProject(PROJECT_ID!)
  .setKey(API_KEY!);

const databases = new Databases(client);

interface SchemaAttr {
  key: string;
  type: string;
  required?: boolean;
  default?: unknown;
  size?: number;
  array?: boolean;
  values?: string[];
}

interface SchemaIndex {
  key: string;
  type: string;
  attributes: string[];
}

// Collection schema definitions - matches lib/types/index.ts
const collectionSchemas: Record<string, { attributes: SchemaAttr[]; indexes: SchemaIndex[] }> = {
  [COLLECTIONS.USERS]: {
    attributes: [
      { key: 'name', type: 'string', required: true, size: 255 },
      { key: 'email', type: 'email', required: true, size: 255 },
      {
        key: 'role',
        type: 'enum',
        required: true,
        values: ['admin', 'developer', 'team_lead', 'agent', 'lead_generation', 'monitor', 'operations'],
        default: 'agent'
      },
      { key: 'teamLeadId', type: 'string', required: false, size: 255 },
      { key: 'branchIds', type: 'string', array: true, required: false, size: 255 },
      { key: 'branchId', type: 'string', required: false, size: 255 },
      { key: 'isActive', type: 'boolean', required: false, default: true },
    ],
    indexes: [
      { key: 'email_idx', type: 'unique', attributes: ['email'] },
      { key: 'role_idx', type: 'key', attributes: ['role'] },
      { key: 'team_lead_idx', type: 'key', attributes: ['teamLeadId'] },
      { key: 'branch_idx', type: 'key', attributes: ['branchIds'] },
    ],
  },
  [COLLECTIONS.LEADS]: {
    attributes: [
      { key: 'data', type: 'string', required: true },
      { key: 'status', type: 'string', required: true, size: 50 },
      { key: 'ownerId', type: 'string', required: true, size: 255 },
      { key: 'assignedToId', type: 'string', required: false, size: 255 },
      { key: 'branchId', type: 'string', required: false, size: 255 },
      { key: 'isClosed', type: 'boolean', required: false, default: false },
      { key: 'closedAt', type: 'datetime', required: false },
      { key: 'nextFollowUpAt', type: 'datetime', required: false },
      { key: 'nextAction', type: 'string', required: false, size: 255 },
      { key: 'lastContactedAt', type: 'datetime', required: false },
      { key: 'followUpStatus', type: 'string', required: false, size: 50 },
    ],
    indexes: [
      { key: 'owner_idx', type: 'key', attributes: ['ownerId'] },
      { key: 'assigned_idx', type: 'key', attributes: ['assignedToId'] },
      { key: 'status_idx', type: 'key', attributes: ['status'] },
      { key: 'branch_idx', type: 'key', attributes: ['branchId'] },
      { key: 'closed_status_idx', type: 'key', attributes: ['isClosed', 'status'] },
    ],
  },
  [COLLECTIONS.BRANCHES]: {
    attributes: [
      { key: 'name', type: 'string', required: true, size: 255 },
      { key: 'isActive', type: 'boolean', required: false, default: true },
    ],
    indexes: [
      { key: 'name_idx', type: 'key', attributes: ['name'] },
      { key: 'active_idx', type: 'key', attributes: ['isActive'] },
    ],
  },
};

// Fields to remove (retired manager/assistant_manager fields, plus the
// branchIds attribute on the leads collection which is now branchId)
const deprecatedFields = ['managerId', 'managerIds', 'assistantManagerId', 'assistantManagerIds'];

// Per-collection fields to remove (scoped by collectionId)
const deprecatedFieldsByCollection: Record<string, string[]> = {
  [COLLECTIONS.LEADS]: ['branchIds'],
};

async function syncAttr(
  collectionId: string,
  attr: SchemaAttr,
  currentAttrs: any[],
  dryRun: boolean
) {
  const current = currentAttrs.find((a: any) => a.key === attr.key);

  console.log(`  ${attr.key}: ${attr.type}${attr.array ? '[]' : ''} (required: ${attr.required ?? false})`);

  // Delete deprecated fields
  if (deprecatedFields.includes(attr.key)) {
    if (current && !dryRun) {
      console.log(`    🔥 Deleting deprecated field: ${attr.key}`);
      try {
        await databases.deleteAttribute(DATABASE_ID, collectionId, attr.key);
        console.log(`    ✅ Deleted`);
      } catch (e: any) {
        console.log(`    ⚠️  ${e.message}`);
      }
    } else {
      console.log(`    [DRY RUN] Would delete deprecated field: ${attr.key}`);
    }
    return;
  }

  if (current) {
    console.log(`    ℹ️  Exists (type: ${current.type})`);
    return;
  }

  // Create new attribute
  if (dryRun) {
    console.log(`    [DRY RUN] Would CREATE ${attr.key}`);
    return;
  }

  console.log(`    ➕ Creating...`);
  try {
    if (attr.type === 'string' && attr.size) {
      await databases.createStringAttribute(
        DATABASE_ID,
        collectionId,
        attr.key,
        attr.size,
        attr.required ?? false,
        attr.default as string | undefined
      );
    } else if (attr.type === 'email' && attr.size) {
      await databases.createEmailAttribute(
        DATABASE_ID,
        collectionId,
        attr.key,
        attr.size,
        attr.required ?? false,
        attr.default as string | undefined
      );
    } else if (attr.type === 'enum' && attr.values) {
      await databases.createEnumAttribute(
        DATABASE_ID,
        collectionId,
        attr.key,
        attr.values,
        attr.required ?? false,
        attr.default as string | undefined
      );
    } else if (attr.type === 'boolean') {
      await databases.createBooleanAttribute(
        DATABASE_ID,
        collectionId,
        attr.key,
        attr.required ?? false,
        attr.default as boolean | undefined
      );
    } else if (attr.type === 'datetime') {
      await databases.createDatetimeAttribute(
        DATABASE_ID,
        collectionId,
        attr.key,
        attr.required ?? false
      );
    } else if (attr.array) {
      await databases.createArrayAttribute(
        DATABASE_ID,
        collectionId,
        attr.key,
        attr.size ?? 255,
        attr.required ?? false
      );
    }
    console.log(`    ✅ Created`);
  } catch (e: any) {
    console.log(`    ⚠️  ${e.message}`);
  }
}

async function syncIndex(
  collectionId: string,
  idx: SchemaIndex,
  currentIndexes: any[],
  dryRun: boolean
) {
  const current = currentIndexes.find((i: any) => i.key === idx.key);

  console.log(`  ${idx.key}: ${idx.type} on [${idx.attributes.join(', ')}]`);

  if (current) {
    console.log(`    ℹ️  Exists`);
    return;
  }

  if (dryRun) {
    console.log(`    [DRY RUN] Would CREATE index: ${idx.key}`);
    return;
  }

  console.log(`    ➕ Creating...`);
  try {
    await databases.createIndex(
      DATABASE_ID,
      collectionId,
      idx.attributes,
      idx.key,
      idx.type as any
    );
    console.log(`    ✅ Created`);
  } catch (e: any) {
    console.log(`    ⚠️  ${e.message}`);
  }
}

async function syncCollection(collectionId: string, schema: typeof collectionSchemas['users'], dryRun: boolean) {
  console.log(`\n🔍 Collection: ${collectionId}`);

  // Get current schema
  const attrsRes = await databases.listAttributes(DATABASE_ID, collectionId);
  const currentAttrs = attrsRes.attributes as any[];
  console.log(`  Current attributes: ${currentAttrs.length}`);

  // Check for deprecated fields in live data
  const deprecatedFieldsForCollection = [...deprecatedFields, ...(deprecatedFieldsByCollection[collectionId] ?? [])];
  for (const liveAttr of currentAttrs) {
    if (deprecatedFieldsForCollection.includes(liveAttr.key)) {
      console.log(`  🔥 Deprecated field in live data: ${liveAttr.key}`);
      if (!dryRun) {
        try {
          await databases.deleteAttribute(DATABASE_ID, collectionId, liveAttr.key);
          console.log(`    ✅ Deleted`);
        } catch (e: any) {
          console.log(`    ⚠️  ${e.message}`);
        }
      } else {
        console.log(`    [DRY RUN] Would delete`);
      }
    }
  }

  // Sync attributes
  for (const attr of schema.attributes) {
    await syncAttr(collectionId, attr, currentAttrs, dryRun);
  }

  // Sync indexes
  const idxsRes = await databases.listIndexes(DATABASE_ID, collectionId);
  const currentIndexes = idxsRes.indexes as any[];
  console.log(`\n  Current indexes: ${currentIndexes.length}`);

  for (const idx of schema.indexes) {
    await syncIndex(collectionId, idx, currentIndexes, dryRun);
  }
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  console.log(`🚀 Schema sync: ${dryRun ? 'DRY RUN (no writes)' : 'APPLY CHANGES'}\n`);

  // Verify connection
  console.log('🔌 Verifying connection...');
  const dbs = await databases.list();
  console.log(`✅ Connected. Databases: ${dbs.total}`);

  // Sync each collection
  for (const [collectionId, schema] of Object.entries(collectionSchemas)) {
    await syncCollection(collectionId, schema, dryRun);
  }

  console.log(`\n🎉 Done! ${dryRun ? '(dry run - no changes written)' : '(changes applied)'}`);
}

main().catch((e) => {
  console.error('❌ Error:', e.message);
  process.exit(1);
});