/**
 * Backfill the lg_handoffs collection from historical leads.
 *
 * For every lead whose owner is a lead_generation actor and whose
 * `assignedToId` points to a team_lead, write one lg_handoffs row
 * keyed on `leadId`. After the row is in place, the "Lead Gen Team
 * Handoffs" dashboard count is exact by construction: a later
 * reassignment never produces a new row.
 *
 * Why a one-off script instead of inline on first read? The dashboard
 * reads lg_handoffs grouped by `teamLeadId`. Without the backfill the
 * historical handoffs (created before the lg_handoffs collection
 * existed) are invisible to the dashboard, so a TL who was the
 * original recipient of a lead reassigned yesterday would show
 * zero handoffs even though they had three yesterday morning.
 *
 * Run:
 *   bun run scripts/backfill-lg-handoffs.ts                # dry-run
 *   bun run scripts/backfill-lg-handoffs.ts -- --apply     # apply
 *
 * Default mode is dry-run. Pass --apply to write rows.
 */

import { Client, Databases, Query } from 'node-appwrite';
import * as dotenv from 'dotenv';
import * as path from 'path';

// ─── Env loading ────────────────────────────────────────────────────────────

const envPath = path.resolve(process.cwd(), '.env.local');
dotenv.config({ path: envPath });
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const ENDPOINT =
  process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT || 'https://cloud.appwrite.io/v1';
const PROJECT_ID = process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID;
const API_KEY = process.env.APPWRITE_API_KEY;
const DATABASE_ID =
  process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID || 'crm-database-1';
const LEADS_COLLECTION_ID =
  process.env.NEXT_PUBLIC_APPWRITE_LEADS_COLLECTION_ID || 'leads';
const USERS_COLLECTION_ID =
  process.env.NEXT_PUBLIC_APPWRITE_USERS_COLLECTION_ID || 'users';
const LG_HANDOFFS_COLLECTION_ID =
  process.env.NEXT_PUBLIC_APPWRITE_LG_HANDOFFS_COLLECTION_ID || 'lg_handoffs';

const APPLY = process.argv.includes('--apply');

if (!PROJECT_ID || !API_KEY) {
  console.error('❌ Missing required env vars:');
  console.error('   - NEXT_PUBLIC_APPWRITE_PROJECT_ID');
  console.error('   - APPWRITE_API_KEY');
  process.exit(1);
}

console.log('Config:', {
  ENDPOINT,
  PROJECT_ID: PROJECT_ID.substring(0, 4) + '***',
  DATABASE_ID,
  LG_HANDOFFS_COLLECTION_ID,
  APPLY,
});

// ─── Client setup ───────────────────────────────────────────────────────────

const client = new Client()
  .setEndpoint(ENDPOINT)
  .setProject(PROJECT_ID)
  .setKey(API_KEY);

const databases = new Databases(client);

// ─── Helpers ────────────────────────────────────────────────────────────────

function isNotFound(error: unknown) {
  const code = (error as { code?: number } | null | undefined)?.code;
  return code === 404;
}

function isConflict(error: unknown) {
  const code = (error as { code?: number } | null | undefined)?.code;
  return code === 409;
}

async function listAllLeads(): Promise<
  Array<{
    $id: string;
    ownerId: string;
    assignedToId: string | null;
    branchId: string | null;
    $createdAt?: string;
  }>
> {
  const all: Array<{
    $id: string;
    ownerId: string;
    assignedToId: string | null;
    branchId: string | null;
    $createdAt?: string;
  }> = [];
  let offset = 0;
  const pageSize = 500;
  // Defensive cap: stop after 100k leads to avoid an infinite loop if
  // pagination ever stops advancing.
  for (let i = 0; i < 200; i += 1) {
    const response = await databases.listDocuments(
      DATABASE_ID,
      LEADS_COLLECTION_ID,
      [
        Query.limit(pageSize),
        Query.offset(offset),
        Query.select(['$id', 'ownerId', 'assignedToId', 'branchId', '$createdAt']),
      ],
    );
    for (const doc of response.documents) {
      all.push({
        $id: String((doc as { $id?: unknown }).$id ?? ''),
        ownerId: String((doc as { ownerId?: unknown }).ownerId ?? ''),
        assignedToId:
          (doc as { assignedToId?: unknown }).assignedToId == null
            ? null
            : String((doc as { assignedToId?: unknown }).assignedToId),
        branchId:
          (doc as { branchId?: unknown }).branchId == null
            ? null
            : String((doc as { branchId?: unknown }).branchId),
        $createdAt: (doc as { $createdAt?: string }).$createdAt,
      });
    }
    if (response.documents.length < pageSize) break;
    offset += pageSize;
  }
  return all;
}

async function listAllUsers(): Promise<
  Map<string, { role: string; department: string }>
> {
  const map = new Map<string, { role: string; department: string }>();
  let offset = 0;
  const pageSize = 500;
  for (let i = 0; i < 200; i += 1) {
    const response = await databases.listDocuments(
      DATABASE_ID,
      USERS_COLLECTION_ID,
      [
        Query.limit(pageSize),
        Query.offset(offset),
        Query.select(['$id', 'role', 'department']),
      ],
    );
    for (const doc of response.documents) {
      const id = String((doc as { $id?: unknown }).$id ?? '');
      if (!id) continue;
      map.set(id, {
        role: String((doc as { role?: unknown }).role ?? ''),
        // Missing department defaults to "sales" so legacy users keep
        // contributing. Same default the live action uses.
        department: String(
          (doc as { department?: unknown }).department ?? 'sales',
        ),
      });
    }
    if (response.documents.length < pageSize) break;
    offset += pageSize;
  }
  return map;
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  // 1. Verify the lg_handoffs collection exists. We can't tell
  //    listDocuments apart from "no rows" vs "no collection" so we
  //    do a list with limit 1 first.
  try {
    await databases.listDocuments(
      DATABASE_ID,
      LG_HANDOFFS_COLLECTION_ID,
      [Query.limit(1)],
    );
  } catch (err) {
    if (isNotFound(err)) {
      console.error(
        '❌ lg_handoffs collection does not exist. Run `bun run setup:appwrite` first to provision it.',
      );
      process.exit(1);
    }
    throw err;
  }

  // 2. Pull every lead + user.
  const [leads, users] = await Promise.all([listAllLeads(), listAllUsers()]);
  console.log(`Found ${leads.length} leads, ${users.size} users.`);

  // 3. Filter to leads that look like an LG→TL handoff under the
  //    same Sales-only rule the live action uses.
  const handoffLeads = leads.filter((l) => {
    const owner = users.get(l.ownerId);
    const assignee = l.assignedToId ? users.get(l.assignedToId) : null;
    if (!owner || !assignee) return false;
    if (owner.role !== 'lead_generation') return false;
    if (assignee.role !== 'team_lead') return false;
    if (owner.department !== 'sales') return false;
    if (assignee.department !== 'sales') return false;
    return true;
  });
  console.log(`Identified ${handoffLeads.length} LG→TL handoff leads.`);

  if (!APPLY) {
    console.log('\nDry-run mode. Pass --apply to write rows. Sample:');
    for (const lead of handoffLeads.slice(0, 5)) {
      console.log({
        leadId: lead.$id,
        teamLeadId: lead.assignedToId,
        leadGenerationId: lead.ownerId,
        branchId: lead.branchId,
        handedOffAt:
          lead.$createdAt ?? new Date().toISOString(),
      });
    }
    return;
  }

  // 4. Apply: write one row per handoff lead. We use the lead's
  //    $id as the document id so the unique index on `leadId` is
  //    double-protected against a duplicate write.
  let created = 0;
  let skipped = 0;
  let failed = 0;
  for (const lead of handoffLeads) {
    try {
      await databases.createDocument(
        DATABASE_ID,
        LG_HANDOFFS_COLLECTION_ID,
        lead.$id,
        {
          leadId: lead.$id,
          teamLeadId: lead.assignedToId,
          leadGenerationId: lead.ownerId,
          branchId: lead.branchId ?? null,
          handedOffAt: lead.$createdAt ?? new Date().toISOString(),
        },
      );
      created += 1;
    } catch (err) {
      if (isConflict(err)) {
        // Row already exists for this lead. The existing row is
        // already the original handoff (we key on leadId and never
        // overwrite), so this is a no-op.
        skipped += 1;
        continue;
      }
      console.error(`Failed to backfill lead ${lead.$id}:`, err);
      failed += 1;
    }
  }

  console.log({
    created,
    skipped,
    failed,
    total: handoffLeads.length,
  });
}

main().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
