/**
 * Sync Appwrite schema to match the application code.
 *
 * Run: bun run sync:appwrite
 * Dry-run (read-only): bun run sync:appwrite --dry-run
 */
import { Client, Databases, Query } from 'node-appwrite';
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
      {
        key: 'department',
        type: 'enum',
        required: false,
        default: 'sales',
        values: ['sales', 'resume'],
      },
    ],
    indexes: [
      { key: 'email_idx', type: 'unique', attributes: ['email'] },
      { key: 'role_idx', type: 'key', attributes: ['role'] },
      { key: 'team_lead_idx', type: 'key', attributes: ['teamLeadId'] },
      { key: 'branch_idx', type: 'key', attributes: ['branchIds'] },
      { key: 'department_idx', type: 'key', attributes: ['department'] },
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
  [COLLECTIONS.CHAT_MESSAGES]: {
    attributes: [
      { key: 'channel', type: 'string', required: true, size: 32 },
      { key: 'body', type: 'string', required: true, size: 8000 },
      { key: 'createdById', type: 'string', required: true, size: 64 },
      { key: 'createdByName', type: 'string', required: true, size: 255 },
      { key: 'createdAt', type: 'datetime', required: true },
      {
        key: 'department',
        type: 'enum',
        required: false,
        default: 'sales',
        values: ['sales', 'resume'],
      },
    ],
    indexes: [
      { key: 'channel_idx', type: 'key', attributes: ['channel'] },
      { key: 'department_idx', type: 'key', attributes: ['department'] },
      // Composite index — both filters always co-occur in list queries.
      { key: 'channel_department_idx', type: 'key', attributes: ['channel', 'department'] },
    ],
  },

  // ─── LG Handoffs ────────────────────────────────────────────────────────
  // Source of truth for the "Lead Gen Team Handoffs" dashboard count.
  // One document per (lead, original Team Lead) pair, written the
  // moment a lead_generation actor hands a lead to a Team Lead. The
  // row is NEVER updated or deleted on later reassignments, so the
  // count grouped by `teamLeadId` is exact: it tracks the original
  // handoff, not the current assignee. `leadGenerationId` lets the
  // dashboard build the per-LG breakdown.
  [COLLECTIONS.LG_HANDOFFS]: {
    attributes: [
      { key: 'leadId', type: 'string', required: true, size: 255 },
      { key: 'teamLeadId', type: 'string', required: true, size: 255 },
      { key: 'leadGenerationId', type: 'string', required: true, size: 255 },
      { key: 'handedOffAt', type: 'datetime', required: true },
      { key: 'branchId', type: 'string', required: false, size: 255 },
    ],
    indexes: [
      { key: 'lead_idx', type: 'unique', attributes: ['leadId'] },
      { key: 'team_lead_idx', type: 'key', attributes: ['teamLeadId'] },
      { key: 'lead_generation_idx', type: 'key', attributes: ['leadGenerationId'] },
      { key: 'handed_off_idx', type: 'key', attributes: ['handedOffAt'] },
    ],
  },

  // ─── Not Interested Leads ─────────────────────────────────────────────────
  // Source of truth for the "Not Interested" column in the weekly
  // report. One document per marking event — a lead can accumulate
  // multiple rows across its lifetime. Status flips from "active" to
  // "reopened" on retry; reports count only active rows in range and
  // attribute them to `previousOwnerId`. NOT unique on `leadId` — by
  // design, each retry cycle produces a new event row.
  [COLLECTIONS.NOT_INTERESTED_LEADS]: {
    attributes: [
      { key: 'leadId', type: 'string', required: true, size: 255 },
      { key: 'markedById', type: 'string', required: true, size: 255 },
      { key: 'markedByName', type: 'string', required: true, size: 255 },
      { key: 'markedAt', type: 'datetime', required: true },
      { key: 'previousOwnerId', type: 'string', required: true, size: 255 },
      { key: 'previousAssignedToId', type: 'string', required: false, size: 255 },
      { key: 'branchId', type: 'string', required: false, size: 255 },
      { key: 'reason', type: 'string', required: false, size: 500 },
      {
        key: 'status',
        type: 'enum',
        required: true,
        default: 'active',
        values: ['active', 'reopened'],
      },
      { key: 'reopenedAt', type: 'datetime', required: false },
      { key: 'reopenedById', type: 'string', required: false, size: 255 },
    ],
    indexes: [
      { key: 'lead_idx', type: 'key', attributes: ['leadId'] },
      { key: 'marked_by_idx', type: 'key', attributes: ['markedById'] },
      { key: 'marked_at_idx', type: 'key', attributes: ['markedAt'] },
      { key: 'status_idx', type: 'key', attributes: ['status'] },
      { key: 'previous_owner_idx', type: 'key', attributes: ['previousOwnerId'] },
      { key: 'branch_idx', type: 'key', attributes: ['branchId'] },
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
      idx.key,
      idx.type as any,
      idx.attributes,
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

  // One-time backfill: ensure every user has a `department` value.
  // Idempotent — skips docs that already have it set.
  if (!dryRun) {
    await backfillUserDepartments(false);
  } else {
    console.log('\n🧪 [DRY RUN] Would backfill user department defaults to "sales"');
  }

  // One-time backfill: chat messages that pre-date the per-department chat
  // split are tagged as "sales" so they appear in the Sales team stream
  // (the only stream that existed before the split). Idempotent.
  if (!dryRun) {
    await backfillChatMessageDepartments(false);
  } else {
    console.log('\n🧪 [DRY RUN] Would backfill chat_messages.department defaults to "sales"');
  }

  console.log(`\n🎉 Done! ${dryRun ? '(dry run - no changes written)' : '(changes applied)'}`);
}

/**
 * Backfill `department = 'sales'` on every user document that does not have
 * the attribute set. Safe to re-run — docs that already have a value are skipped.
 */
async function backfillUserDepartments(dryRun: boolean): Promise<void> {
  console.log(`\n🧪 Backfilling users.department (${dryRun ? 'DRY RUN' : 'APPLY'})`);

  const PAGE_SIZE = 100;
  let offset = 0;
  let totalScanned = 0;
  let totalUpdated = 0;

  while (true) {
    const page = await databases.listDocuments(
      DATABASE_ID,
      COLLECTIONS.USERS,
      [Query.limit(PAGE_SIZE), Query.offset(offset)]
    );

    if (page.documents.length === 0) break;

    for (const doc of page.documents) {
      totalScanned += 1;
      if (doc.department) continue;

      if (dryRun) {
        console.log(`  [DRY RUN] Would set department='sales' on user ${doc.$id}`);
        continue;
      }

      try {
        await databases.updateDocument(
          DATABASE_ID,
          COLLECTIONS.USERS,
          doc.$id,
          { department: 'sales' }
        );
        totalUpdated += 1;
      } catch (e: any) {
        console.log(`  ⚠️  Failed to update user ${doc.$id}: ${e?.message ?? e}`);
      }
    }

    offset += page.documents.length;
    if (page.documents.length < PAGE_SIZE) break;
  }

  console.log(`  Scanned ${totalScanned} user(s); updated ${totalUpdated}.`);
}

/**
 * Backfill `department = 'sales'` on every chat message that does not have
 * the attribute set. Pre-split messages are by definition Sales-team
 * messages because the Resume team is brand new. Safe to re-run — docs
 * that already have a value are skipped.
 */
async function backfillChatMessageDepartments(dryRun: boolean): Promise<void> {
  console.log(`\n🧪 Backfilling chat_messages.department (${dryRun ? 'DRY RUN' : 'APPLY'})`);

  const PAGE_SIZE = 100;
  let offset = 0;
  let totalScanned = 0;
  let totalUpdated = 0;

  while (true) {
    const page = await databases.listDocuments(
      DATABASE_ID,
      COLLECTIONS.CHAT_MESSAGES,
      [Query.limit(PAGE_SIZE), Query.offset(offset)]
    );

    if (page.documents.length === 0) break;

    for (const doc of page.documents) {
      totalScanned += 1;
      if (doc.department) continue;

      if (dryRun) {
        console.log(`  [DRY RUN] Would set department='sales' on chat message ${doc.$id}`);
        continue;
      }

      try {
        await databases.updateDocument(
          DATABASE_ID,
          COLLECTIONS.CHAT_MESSAGES,
          doc.$id,
          { department: 'sales' }
        );
        totalUpdated += 1;
      } catch (e: any) {
        console.log(`  ⚠️  Failed to update chat message ${doc.$id}: ${e?.message ?? e}`);
      }
    }

    offset += page.documents.length;
    if (page.documents.length < PAGE_SIZE) break;
  }

  console.log(`  Scanned ${totalScanned} chat message(s); updated ${totalUpdated}.`);
}

main().catch((e) => {
  console.error('❌ Error:', e.message);
  process.exit(1);
});