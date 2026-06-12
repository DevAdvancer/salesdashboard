/**
 * Migrate legacy "not interested" leads to the current canonical shape.
 *
 * Current shape (see lib/actions/lead-actions.ts -> notInterestedLeadAction):
 *   status:        "Not Interested"
 *   isClosed:      false
 *   closedAt:      null
 *   ownerId:       APPWRITE_UNASSIGNED_OWNER_ID
 *   assignedToId:  null
 *   permissions:   unassigned owner (r/w/d) + admin label (r/w/d) +
 *                  unassigned owner's hierarchy (r/w/d) + actor (r)
 *   linkedin_request: reset to { status: "sent", isActive: true,
 *                  leadId: null, acceptedAt: null, withdrawnAt: null }
 *                  plus a LINKEDIN_REQUEST_REOPEN audit log and a
 *                  "Linkedin URL available again" chat message.
 *
 * Outliers this script normalizes:
 *   - status is any variant of "Not Interested" (e.g. "Not-Interested")
 *   - isClosed is true (old behavior closed the lead)
 *   - closedAt is populated
 *   - ownerId is still the original agent (not the unassigned owner)
 *   - assignedToId is still set
 *   - the linked LinkedIn request is still active / linked
 *
 * Leads that already match the canonical shape are skipped.
 *
 * Run:
 *   bun run migrate:not-interested                 # dry-run
 *   bun run migrate:not-interested -- --apply      # apply
 *   bun run migrate:not-interested -- --apply --limit=50
 *
 * The script defaults to a dry-run report so you can preview the work
 * before mutating the database. Pass --apply to perform updates.
 */

import { Client, Databases, ID, Permission, Query, Role } from 'node-appwrite';
import * as dotenv from 'dotenv';
import * as path from 'path';

// ─── Env loading ────────────────────────────────────────────────────────────

const envPath = path.resolve(process.cwd(), '.env.local');
dotenv.config({ path: envPath });
// Fall back to .env if .env.local is missing (matches the rest of the repo).
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const ENDPOINT =
  process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT || 'https://cloud.appwrite.io/v1';
const PROJECT_ID = process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID;
const API_KEY = process.env.APPWRITE_API_KEY;
const DATABASE_ID =
  process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID || 'crm-database-1';
const LEADS_COLLECTION_ID =
  process.env.NEXT_PUBLIC_APPWRITE_LEADS_COLLECTION_ID || 'leads';
const LINKEDIN_REQUESTS_COLLECTION_ID =
  process.env.NEXT_PUBLIC_APPWRITE_LINKEDIN_REQUESTS_COLLECTION_ID ||
  'linkedin_requests';
const AUDIT_LOGS_COLLECTION_ID =
  process.env.NEXT_PUBLIC_APPWRITE_AUDIT_LOGS_COLLECTION_ID || 'audit_logs';
const CHAT_MESSAGES_COLLECTION_ID =
  process.env.NEXT_PUBLIC_APPWRITE_CHAT_MESSAGES_COLLECTION_ID ||
  'chat_messages';
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
    '❌ APPWRITE_UNASSIGNED_OWNER_ID is not set. The migration cannot hand leads to the unassigned queue without it.',
  );
  process.exit(1);
}

console.log('Config:', {
  ENDPOINT,
  PROJECT_ID: PROJECT_ID.substring(0, 4) + '***',
  DATABASE_ID,
  LEADS_COLLECTION_ID,
  UNASSIGNED_OWNER_ID,
  APPLY,
  LIMIT: LIMIT || 'none',
});

// ─── Client setup ───────────────────────────────────────────────────────────

const client = new Client()
  .setEndpoint(ENDPOINT)
  .setProject(PROJECT_ID)
  .setKey(API_KEY);

const databases = new Databases(client);

// ─── Helpers (mirror lib/actions/lead-actions.ts) ───────────────────────────

const NOT_INTERESTED_STATUS_VALUES = [
  'Not Interested',
  'Not-Interested',
  'Not interested',
  'not interested',
  'NotInterested',
  'notinterested',
];

const NOT_INTERESTED_NORMALIZED = 'notinterested';

type HierarchyUserDocument = {
  $id: string;
  teamLeadId?: string | null;
};

type LeadDocument = {
  $id: string;
  status?: string;
  isClosed?: boolean;
  closedAt?: string | null;
  ownerId?: string;
  assignedToId?: string | null;
  branchId?: string | null;
  $createdAt?: string;
  $updatedAt?: string;
  $permissions?: string[];
  data?: string;
};

function normalizeStatusText(value: unknown): string {
  const text = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return text.replace(/[^a-z0-9]/g, '');
}

async function getHierarchyPermissionsServer(
  userId: string,
): Promise<string[]> {
  if (!userId) return [];
  const permissions: string[] = [];
  const visited = new Set<string>([userId]);
  let currentId: string | null = userId;

  for (let depth = 0; depth < 5 && currentId; depth += 1) {
    let user: HierarchyUserDocument;
    try {
      user = (await databases.getDocument(
        DATABASE_ID,
        process.env.NEXT_PUBLIC_APPWRITE_USERS_COLLECTION_ID || 'users',
        currentId,
      )) as unknown as HierarchyUserDocument;
    } catch {
      break;
    }

    if (user.teamLeadId && !visited.has(user.teamLeadId)) {
      permissions.push(Permission.read(Role.user(user.teamLeadId)));
      permissions.push(Permission.update(Role.user(user.teamLeadId)));
      permissions.push(Permission.delete(Role.user(user.teamLeadId)));
      visited.add(user.teamLeadId);
    }

    if (user.teamLeadId && !visited.has(user.teamLeadId)) {
      currentId = user.teamLeadId;
    } else {
      currentId = null;
    }
  }

  return permissions;
}

function getLeadDataField(lead: LeadDocument, field: string): string | null {
  if (typeof lead.data !== 'string') return null;
  try {
    const parsed = JSON.parse(lead.data) as Record<string, unknown>;
    const value = parsed[field];
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  } catch {
    return null;
  }
}

function isCanonicalNotInterested(lead: LeadDocument): boolean {
  if (lead.status !== 'Not Interested') return false;
  if (lead.isClosed === true) return false;
  if (lead.closedAt) return false;
  if (lead.ownerId !== UNASSIGNED_OWNER_ID) return false;
  if (lead.assignedToId) return false;
  return true;
}

function describeOutlier(lead: LeadDocument): string[] {
  const reasons: string[] = [];
  if (lead.status !== 'Not Interested') {
    reasons.push(`status=${JSON.stringify(lead.status ?? null)}`);
  }
  if (lead.isClosed === true) reasons.push('isClosed=true');
  if (lead.closedAt) reasons.push(`closedAt=${lead.closedAt}`);
  if (lead.ownerId !== UNASSIGNED_OWNER_ID) {
    reasons.push(`ownerId=${lead.ownerId ?? 'null'}`);
  }
  if (lead.assignedToId) {
    reasons.push(`assignedToId=${lead.assignedToId}`);
  }
  return reasons;
}

async function resetLinkedinRequest(
  lead: LeadDocument,
  actorId: string,
  actorName: string,
  occurredAt: string,
): Promise<void> {
  const requestId = getLeadDataField(lead, 'linkedinRequestId');
  if (!requestId) return;

  let requestDoc: { status?: string; isActive?: boolean; leadId?: unknown; targetUrl?: string; company?: string };
  try {
    requestDoc = await databases.getDocument(
      DATABASE_ID,
      LINKEDIN_REQUESTS_COLLECTION_ID,
      requestId,
    );
  } catch {
    return;
  }

  if (
    requestDoc.status === 'sent' &&
    requestDoc.isActive === true &&
    requestDoc.leadId === null
  ) {
    return;
  }

  try {
    await databases.updateDocument(
      DATABASE_ID,
      LINKEDIN_REQUESTS_COLLECTION_ID,
      requestId,
      {
        status: 'sent',
        isActive: true,
        leadId: null,
        acceptedAt: null,
        withdrawnAt: null,
      },
    );
  } catch (err) {
    console.warn(
      `   ⚠️  failed to reset linkedin request ${requestId}: ${(err as Error).message}`,
    );
    return;
  }

  try {
    await databases.createDocument(
      DATABASE_ID,
      AUDIT_LOGS_COLLECTION_ID,
      ID.unique(),
      {
        action: 'LINKEDIN_REQUEST_REOPEN',
        actorId,
        actorName,
        targetId: requestId,
        targetType: 'linkedin_request',
        metadata: JSON.stringify({
          leadId: lead.$id,
          targetUrl: requestDoc.targetUrl,
          company: requestDoc.company,
          reason: 'Lead normalized to Not Interested via migration script',
          reopenedAt: occurredAt,
          source: 'migrate-not-interested-leads',
        }),
        performedAt: occurredAt,
      },
    );
  } catch (err) {
    console.warn(
      `   ⚠️  failed to write linkedin reopen audit for ${requestId}: ${(err as Error).message}`,
    );
  }

  try {
    await databases.createDocument(
      DATABASE_ID,
      CHAT_MESSAGES_COLLECTION_ID,
      ID.unique(),
      {
        channel: 'general',
        body: `Linkedin URL available again: ${requestDoc.targetUrl} (${requestDoc.company}) lead was normalized to Not Interested by ${actorName}. Another agent can try this URL.`,
        createdById: actorId,
        createdByName: actorName,
        createdAt: occurredAt,
      },
    );
  } catch {
    // chat is best-effort
  }
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function listAllLeadsWithNotInterested(): Promise<LeadDocument[]> {
  const leads: LeadDocument[] = [];
  let cursor: string | null = null;
  const maxPages = 500;

  for (let page = 0; page < maxPages; page += 1) {
    const queries: string[] = [
      Query.equal('status', NOT_INTERESTED_STATUS_VALUES),
      Query.orderAsc('$id'),
      Query.limit(100),
    ];
    if (cursor) queries.push(Query.cursorAfter(cursor));

    const response = await databases.listDocuments(
      DATABASE_ID,
      LEADS_COLLECTION_ID,
      queries,
    );

    for (const doc of response.documents) {
      if (normalizeStatusText(doc.status) === NOT_INTERESTED_NORMALIZED) {
        leads.push(doc);
      }
    }

    if (response.documents.length < 100) break;
    const last = response.documents[response.documents.length - 1];
    if (!last?.$id) break;
    cursor = last.$id;
  }

  return leads;
}

async function run() {
  const allNotInterested = await listAllLeadsWithNotInterested();
  const outliers = allNotInterested.filter(
    (lead) => !isCanonicalNotInterested(lead),
  );
  const target = LIMIT > 0 ? outliers.slice(0, LIMIT) : outliers;

  console.log(
    `\nFound ${allNotInterested.length} leads with "Not Interested" status.`,
  );
  console.log(
    `Out-of-shape leads: ${outliers.length}${LIMIT > 0 ? ` (limited to ${LIMIT})` : ''}.`,
  );

  if (outliers.length === 0) {
    console.log('Nothing to migrate. ✅');
    return;
  }

  console.log('\nSample outlier reasons:');
  for (const lead of target.slice(0, 5)) {
    const name = getLeadDataField(lead, 'firstName') ?? lead.$id;
    console.log(
      `   - ${name} (${lead.$id}) -> ${describeOutlier(lead).join(', ')}`,
    );
  }
  if (target.length > 5) console.log(`   ... and ${target.length - 5} more`);

  if (!APPLY) {
    console.log(
      '\nDRY-RUN: no documents were updated. Re-run with --apply to perform the migration.',
    );
    return;
  }

  const actorId = UNASSIGNED_OWNER_ID;
  const actorName = 'Migration Script';

  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for (const lead of target) {
    try {
      const nowIso = new Date().toISOString();
      const permissions: string[] = [
        Permission.read(Role.user(UNASSIGNED_OWNER_ID)),
        Permission.update(Role.user(UNASSIGNED_OWNER_ID)),
        Permission.delete(Role.user(UNASSIGNED_OWNER_ID)),
        Permission.read(Role.label('admin')),
        Permission.update(Role.label('admin')),
        Permission.delete(Role.label('admin')),
      ];
      const hierarchyPerms = await getHierarchyPermissionsServer(
        UNASSIGNED_OWNER_ID,
      );
      permissions.push(...hierarchyPerms);

      await databases.updateDocument(
        DATABASE_ID,
        LEADS_COLLECTION_ID,
        lead.$id,
        {
          ownerId: UNASSIGNED_OWNER_ID,
          assignedToId: null,
          isClosed: false,
          closedAt: null,
          status: 'Not Interested',
        },
        [...new Set(permissions)],
      );

      await resetLinkedinRequest(lead, actorId, actorName, nowIso);

      try {
        await databases.createDocument(
          DATABASE_ID,
          AUDIT_LOGS_COLLECTION_ID,
          ID.unique(),
          {
            action: 'LEAD_UPDATE',
            actorId,
            actorName,
            targetId: lead.$id,
            targetType: 'LEAD',
            metadata: JSON.stringify({
              status: 'Not Interested',
              ownerId: UNASSIGNED_OWNER_ID,
              assignedToId: null,
              isClosed: false,
              closedAt: null,
              previousStatus: lead.status,
              previousIsClosed: lead.isClosed,
              previousOwnerId: lead.ownerId,
              previousAssignedToId: lead.assignedToId,
              previousClosedAt: lead.closedAt,
              source: 'migrate-not-interested-leads',
            }),
            performedAt: nowIso,
          },
        );
      } catch (err) {
        console.warn(
          `   ⚠️  failed to write audit log for ${lead.$id}: ${(err as Error).message}`,
        );
      }

      updated += 1;
      if (updated % 25 === 0) {
        console.log(`   ... ${updated}/${target.length} migrated`);
      }
    } catch (err) {
      failed += 1;
      console.error(`   ✗ ${lead.$id} failed: ${(err as Error).message}`);
    }
  }

  const untouched = outliers.length - target.length;
  if (untouched > 0) skipped = untouched;

  console.log('\nDone.');
  console.log(`   updated: ${updated}`);
  console.log(`   failed:  ${failed}`);
  console.log(`   skipped (over --limit): ${skipped}`);
}

run().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
