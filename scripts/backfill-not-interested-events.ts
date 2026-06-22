/**
 * Backfill `not_interested_leads` from leads that already sit in the
 * "Not Interested" status. Run once after the new collection is
 * provisioned by `bun run sync:appwrite`.
 *
 * For every lead with status = "Not Interested":
 *   1. Look up the most recent LEAD_UPDATE audit log that flipped it
 *      into that status — this gives us the actor and timestamp.
 *   2. If no audit log is found (legacy leads migrated by hand), fall
 *      back to the lead's $updatedAt with a synthetic marker using the
 *      unassigned owner and log a warning so the operator can review.
 *   3. Create a `not_interested_leads` row with status: "active",
 *      attributed to the lead's previous owner. Idempotent — skip if
 *      an active row already exists for the lead.
 *
 * Run:
 *   bun run scripts/backfill-not-interested-events.ts            # dry-run
 *   bun run scripts/backfill-not-interested-events.ts -- --apply # apply
 *   bun run scripts/backfill-not-interested-events.ts -- --apply --limit=50
 */

import { Client, Databases, ID, Query } from 'node-appwrite';
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
const NOT_INTERESTED_LEADS_COLLECTION_ID =
  process.env.NEXT_PUBLIC_APPWRITE_NOT_INTERESTED_LEADS_COLLECTION_ID ||
  'not_interested_leads';
const AUDIT_LOGS_COLLECTION_ID =
  process.env.NEXT_PUBLIC_APPWRITE_AUDIT_LOGS_COLLECTION_ID || 'audit_logs';
const USERS_COLLECTION_ID =
  process.env.NEXT_PUBLIC_APPWRITE_USERS_COLLECTION_ID || 'users';
const UNASSIGNED_OWNER_ID =
  process.env.APPWRITE_UNASSIGNED_OWNER_ID ||
  process.env.NEXT_PUBLIC_APPWRITE_UNASSIGNED_OWNER_ID ||
  '';

const APPLY = process.argv.includes('--apply');
const LIMIT_ARG = process.argv.find((arg) => arg.startsWith('--limit='));
const LIMIT = LIMIT_ARG ? Math.max(0, Number(LIMIT_ARG.split('=')[1]) || 0) : 0;

if (!PROJECT_ID || !API_KEY) {
  console.error('❌ Missing required env vars:');
  console.error('   - NEXT_PUBLIC_APPWRITE_PROJECT_ID');
  console.error('   - APPWRITE_API_KEY');
  console.error('   Set them in .env.local (or .env) and try again.');
  process.exit(1);
}

if (!UNASSIGNED_OWNER_ID) {
  console.error(
    '❌ APPWRITE_UNASSIGNED_OWNER_ID is not set. The backfill cannot attribute legacy marks without it.',
  );
  process.exit(1);
}

console.log('Config:', {
  ENDPOINT,
  PROJECT_ID: PROJECT_ID.substring(0, 4) + '***',
  DATABASE_ID,
  LEADS_COLLECTION_ID,
  NOT_INTERESTED_LEADS_COLLECTION_ID,
  AUDIT_LOGS_COLLECTION_ID,
  UNASSIGNED_OWNER_ID: UNASSIGNED_OWNER_ID.substring(0, 6) + '***',
  APPLY,
  LIMIT: LIMIT || 'none',
});

// ─── Client setup ───────────────────────────────────────────────────────────

const client = new Client()
  .setEndpoint(ENDPOINT)
  .setProject(PROJECT_ID)
  .setKey(API_KEY);

const databases = new Databases(client);

// ─── Types ──────────────────────────────────────────────────────────────────

type LeadDocument = {
  $id: string;
  status?: string;
  ownerId?: string;
  assignedToId?: string | null;
  branchId?: string | null;
  data?: string;
  $updatedAt?: string;
};

type AuditLogDocument = {
  $id: string;
  actorId?: string;
  actorName?: string;
  targetId?: string;
  action?: string;
  targetType?: string;
  metadata?: string;
  performedAt?: string;
  createdAt?: string;
};

type AuditMetadata = {
  status?: string;
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function pickBranchId(lead: LeadDocument): string | null {
  if (typeof lead.data === 'string') {
    try {
      const parsed = JSON.parse(lead.data) as {
        branchIds?: unknown;
        branchId?: unknown;
      };
      if (Array.isArray(parsed.branchIds) && typeof parsed.branchIds[0] === 'string') {
        return parsed.branchIds[0] as string;
      }
      if (typeof parsed.branchId === 'string') {
        return parsed.branchId;
      }
    } catch {
      // fall through
    }
  }
  return lead.branchId ?? null;
}

async function findAuditLogForLead(leadId: string): Promise<AuditLogDocument | null> {
  try {
    const result = await databases.listDocuments(
      DATABASE_ID,
      AUDIT_LOGS_COLLECTION_ID,
      [
        Query.equal('action', 'LEAD_UPDATE'),
        Query.equal('targetType', 'LEAD'),
        Query.equal('targetId', leadId),
        Query.orderDesc('performedAt'),
        Query.orderDesc('$createdAt'),
        Query.limit(50),
      ],
    );

    for (const doc of result.documents as unknown as AuditLogDocument[]) {
      if (typeof doc.metadata !== 'string') continue;
      try {
        const parsed = JSON.parse(doc.metadata) as AuditMetadata;
        if (parsed.status === 'Not Interested') return doc;
      } catch {
        // ignore malformed metadata
      }
    }
  } catch (err) {
    console.error(`Failed to query audit logs for lead ${leadId}:`, err);
  }
  return null;
}

async function findActiveEventForLead(leadId: string): Promise<boolean> {
  try {
    const result = await databases.listDocuments(
      DATABASE_ID,
      NOT_INTERESTED_LEADS_COLLECTION_ID,
      [
        Query.equal('leadId', leadId),
        Query.equal('status', 'active'),
        Query.limit(1),
      ],
    );
    return result.total > 0 || result.documents.length > 0;
  } catch (err) {
    console.error(
      `Failed to check existing active event for lead ${leadId}; assuming missing:`,
      err,
    );
    return false;
  }
}

async function fetchUserName(userId: string): Promise<string> {
  try {
    const doc = await databases.getDocument(
      DATABASE_ID,
      USERS_COLLECTION_ID,
      userId,
    );
    const name = (doc as unknown as { name?: string }).name;
    return typeof name === 'string' && name.trim() ? name.trim() : userId;
  } catch {
    return userId;
  }
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const stats = {
    scanned: 0,
    skippedAlreadyHaveActiveEvent: 0,
    backfilledFromAuditLog: 0,
    backfilledWithSyntheticMarker: 0,
    failed: 0,
  };

  let offset = 0;
  const pageSize = 100;

  while (true) {
    const page = await databases.listDocuments(
      DATABASE_ID,
      LEADS_COLLECTION_ID,
      [
        Query.equal('status', 'Not Interested'),
        Query.orderAsc('$id'),
        Query.limit(pageSize),
        Query.offset(offset),
      ],
    );

    if (page.documents.length === 0) break;

    for (const lead of page.documents as unknown as LeadDocument[]) {
      stats.scanned += 1;
      if (LIMIT && stats.scanned > LIMIT) {
        console.log(`Hit --limit=${LIMIT}. Stopping.`);
        break;
      }

      const alreadyActive = await findActiveEventForLead(lead.$id);
      if (alreadyActive) {
        stats.skippedAlreadyHaveActiveEvent += 1;
        continue;
      }

      const auditLog = await findAuditLogForLead(lead.$id);

      let markedById: string;
      let markedByName: string;
      let markedAt: string;
      let warning: string | null = null;

      if (auditLog && auditLog.actorId && auditLog.performedAt) {
        markedById = auditLog.actorId;
        markedByName =
          (typeof auditLog.actorName === 'string' && auditLog.actorName.trim()) ||
          (await fetchUserName(auditLog.actorId));
        markedAt = auditLog.performedAt;
      } else {
        // No audit trail — synthesize a marker so the row still appears in
        // reports. Operators can review these in the Appwrite console.
        markedById = UNASSIGNED_OWNER_ID;
        markedByName = await fetchUserName(UNASSIGNED_OWNER_ID);
        markedAt = lead.$updatedAt ?? new Date().toISOString();
        warning = 'no audit log found; used $updatedAt + unassigned owner';
      }

      const previousOwnerId = lead.ownerId ?? '';
      const previousAssignedToId = lead.assignedToId ?? null;
      const branchId = pickBranchId(lead);

      const payload = {
        leadId: lead.$id,
        markedById,
        markedByName,
        markedAt,
        previousOwnerId,
        previousAssignedToId,
        branchId,
        reason: null,
        status: 'active',
      };

      const preview = `[${stats.scanned}] lead=${lead.$id} markedBy=${markedById} at=${markedAt} prevOwner=${previousOwnerId}${warning ? ` (WARN: ${warning})` : ''}`;

      if (APPLY) {
        try {
          await databases.createDocument(
            DATABASE_ID,
            NOT_INTERESTED_LEADS_COLLECTION_ID,
            ID.unique(),
            payload,
          );
          if (warning) stats.backfilledWithSyntheticMarker += 1;
          else stats.backfilledFromAuditLog += 1;
          console.log(`✓ ${preview}`);
        } catch (err) {
          stats.failed += 1;
          console.error(`✗ ${preview} -- ${(err as Error).message}`);
        }
      } else {
        console.log(`DRY ${preview}`);
        if (warning) stats.backfilledWithSyntheticMarker += 1;
        else stats.backfilledFromAuditLog += 1;
      }
    }

    if (LIMIT && stats.scanned >= LIMIT) break;
    if (page.documents.length < pageSize) break;
    offset += pageSize;
  }

  console.log('---');
  console.log('Summary:', stats);
  console.log(`Mode: ${APPLY ? 'APPLIED' : 'DRY-RUN (pass --apply to write)'}`);
}

main().catch((err) => {
  console.error('Backfill crashed:', err);
  process.exit(1);
});
