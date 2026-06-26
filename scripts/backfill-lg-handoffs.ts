/**
 * Backfill `lg_handoffs` from historical audit logs.
 * Runs once to recover handoffs that were not recorded prior to this fix.
 *
 * For every audit log where action = "LEAD_UPDATE" or "LEAD_CREATE" performed by a Lead Gen user:
 *   1. Check if the actor is a "lead_generation" user in "sales".
 *   2. Check if the target was assigned to a "team_lead" user in "sales".
 *   3. Create a `lg_handoffs` document if it does not already exist.
 *
 * Run:
 *   bun run scripts/backfill-lg-handoffs.ts            # dry-run
 *   bun run scripts/backfill-lg-handoffs.ts -- --apply # apply
 */

import { Client, Databases, ID, Query } from 'node-appwrite';
import * as dotenv from 'dotenv';
import * as path from 'path';

// ─── Env loading ────────────────────────────────────────────────────────────

const envPath = path.resolve(process.cwd(), '.env.local');
dotenv.config({ path: envPath });
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const ENDPOINT = process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT || 'https://cloud.appwrite.io/v1';
const PROJECT_ID = process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID;
const API_KEY = process.env.APPWRITE_API_KEY;
const DATABASE_ID = process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID || 'crm-database-1';
const LEADS_COLLECTION_ID = process.env.NEXT_PUBLIC_APPWRITE_LEADS_COLLECTION_ID || 'leads';
const LG_HANDOFFS_COLLECTION_ID = process.env.NEXT_PUBLIC_APPWRITE_LG_HANDOFFS_COLLECTION_ID || 'lg_handoffs';
const AUDIT_LOGS_COLLECTION_ID = process.env.NEXT_PUBLIC_APPWRITE_AUDIT_LOGS_COLLECTION_ID || 'audit_logs';
const USERS_COLLECTION_ID = process.env.NEXT_PUBLIC_APPWRITE_USERS_COLLECTION_ID || 'users';

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
  AUDIT_LOGS_COLLECTION_ID,
  APPLY,
});

// ─── Client setup ───────────────────────────────────────────────────────────

const client = new Client()
  .setEndpoint(ENDPOINT)
  .setProject(PROJECT_ID)
  .setKey(API_KEY);

const databases = new Databases(client);

// ─── Types ──────────────────────────────────────────────────────────────────

type UserDocument = {
  $id: string;
  name?: string;
  role: string;
  department?: string;
};

type LeadDocument = {
  $id: string;
  assignedToId?: string | null;
  branchId?: string | null;
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
  $createdAt?: string;
};

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log('Fetching users to build role/department mapping...');
  const usersMap = new Map<string, UserDocument>();
  let userOffset = 0;
  const userPageSize = 100;
  while (true) {
    const userPage = await databases.listDocuments(
      DATABASE_ID,
      USERS_COLLECTION_ID,
      [Query.limit(userPageSize), Query.offset(userOffset)]
    );
    for (const doc of userPage.documents as unknown as UserDocument[]) {
      usersMap.set(doc.$id, doc);
    }
    if (userPage.documents.length < userPageSize) break;
    userOffset += userPageSize;
  }
  console.log(`Loaded ${usersMap.size} users.`);

  const stats = {
    scannedLogs: 0,
    matchedHandoffs: 0,
    created: 0,
    updated: 0,
    alreadyExisted: 0,
    failed: 0,
  };

  // 1. Fetch existing handoffs to prevent duplicate attempts in memory
  const existingHandoffsMap = new Map<string, { docId: string; branchId: string | null }>();
  let handoffOffset = 0;
  const handoffPageSize = 100;
  console.log('Fetching existing lg_handoffs to avoid duplicate writes...');
  while (true) {
    try {
      const handoffPage = await databases.listDocuments(
        DATABASE_ID,
        LG_HANDOFFS_COLLECTION_ID,
        [Query.limit(handoffPageSize), Query.offset(handoffOffset), Query.select(['$id', 'leadId', 'branchId'])]
      );
      for (const doc of handoffPage.documents) {
        if (doc.leadId) {
          existingHandoffsMap.set(doc.leadId, {
            docId: doc.$id,
            branchId: doc.branchId ?? null,
          });
        }
      }
      if (handoffPage.documents.length < handoffPageSize) break;
      handoffOffset += handoffPageSize;
    } catch (err) {
      console.log('Could not fetch existing handoffs or collection is empty:', (err as Error).message);
      break;
    }
  }
  console.log(`Found ${existingHandoffsMap.size} existing handoff records.`);

  // 2. Fetch and process audit logs
  let auditOffset = 0;
  const auditPageSize = 100;
  console.log('Processing audit logs...');

  while (true) {
    const auditPage = await databases.listDocuments(
      DATABASE_ID,
      AUDIT_LOGS_COLLECTION_ID,
      [
        Query.equal('targetType', 'LEAD'),
        Query.orderDesc('performedAt'),
        Query.limit(auditPageSize),
        Query.offset(auditOffset),
      ]
    );

    if (auditPage.documents.length === 0) break;

    for (const log of auditPage.documents as unknown as AuditLogDocument[]) {
      stats.scannedLogs += 1;
      
      const actorId = log.actorId;
      if (!actorId) continue;
      
      const actor = usersMap.get(actorId);
      if (!actor) continue;

      // Rule: Actor must be a Lead Gen user in the Sales department (defaulting to sales)
      const actorRole = actor.role;
      const actorDept = actor.department ?? 'sales';
      if (actorRole !== 'lead_generation' || actorDept !== 'sales') continue;

      let targetLeadId = log.targetId;
      if (!targetLeadId) continue;

      let assigneeId: string | null = null;
      let branchId: string | null = null;

      // Try fetching the lead document to get the current branchId
      try {
        const lead = await databases.getDocument(
          DATABASE_ID,
          LEADS_COLLECTION_ID,
          targetLeadId
        ) as unknown as LeadDocument;
        branchId = lead.branchId ?? null;
        if (log.action === 'LEAD_CREATE') {
          assigneeId = lead.assignedToId ?? null;
        }
      } catch (err) {
        // Lead deleted or not accessible
      }

      // Parse audit metadata
      if (typeof log.metadata === 'string') {
        try {
          const meta = JSON.parse(log.metadata);
          if (log.action === 'LEAD_UPDATE') {
            if (typeof meta.assignedToId === 'string' && meta.assignedToId) {
              assigneeId = meta.assignedToId;
            }
          }
          if (!branchId) {
            if (typeof meta.branchId === 'string' && meta.branchId) {
              branchId = meta.branchId;
            } else if (typeof meta.branchIds === 'object' && Array.isArray(meta.branchIds) && typeof meta.branchIds[0] === 'string') {
              branchId = meta.branchIds[0];
            }
          }
        } catch {
          // ignore
        }
      }

      if (!assigneeId) continue;

      const assignee = usersMap.get(assigneeId);
      if (!assignee) continue;

      // Rule: Assignee must be a Team Lead in the Sales department
      const assigneeRole = assignee.role;
      const assigneeDept = assignee.department ?? 'sales';
      if (assigneeRole !== 'team_lead' || assigneeDept !== 'sales') continue;

      stats.matchedHandoffs += 1;

      // If already recorded, check if branchId needs updating
      const existing = existingHandoffsMap.get(targetLeadId);
      if (existing) {
        if (branchId && existing.branchId !== branchId) {
          const logMsg = `Handoff branch mismatch: Lead ${targetLeadId} existing branch: ${existing.branchId}, calculated branch: ${branchId}`;
          if (APPLY) {
            try {
              await databases.updateDocument(
                DATABASE_ID,
                LG_HANDOFFS_COLLECTION_ID,
                existing.docId,
                {
                  branchId: branchId,
                }
              );
              existingHandoffsMap.set(targetLeadId, { docId: existing.docId, branchId }); // update in memory
              stats.updated += 1;
              console.log(`✓ Updated branchId: ${logMsg}`);
            } catch (err) {
              console.error(`✗ Failed to update handoff branch for lead ${targetLeadId}: ${(err as Error).message}`);
              stats.failed += 1;
            }
          } else {
            console.log(`DRY-RUN: Would update branchId: ${logMsg}`);
            stats.updated += 1;
          }
        } else {
          stats.alreadyExisted += 1;
        }
        continue;
      }

      const handedOffAt = log.performedAt || log.$createdAt || new Date().toISOString();
      const payload = {
        leadId: targetLeadId,
        teamLeadId: assigneeId,
        leadGenerationId: actorId,
        handedOffAt,
        branchId: branchId || null,
      };

      const logMsg = `Handoff match: Lead ${targetLeadId} assigned by LeadGen ${actorId} (${actor.name}) to TeamLead ${assigneeId} (${assignee.name}) at ${handedOffAt}`;

      if (APPLY) {
        try {
          await databases.createDocument(
            DATABASE_ID,
            LG_HANDOFFS_COLLECTION_ID,
            targetLeadId,
            payload
          );
          existingHandoffsMap.set(targetLeadId, { docId: targetLeadId, branchId: branchId || null }); // track to avoid duplicates
          stats.created += 1;
          console.log(`✓ Created: ${logMsg}`);
        } catch (err) {
          const errMsg = (err as Error).message;
          if (errMsg.includes('unique') || errMsg.includes('conflict') || (err as any).code === 409) {
            stats.alreadyExisted += 1;
            existingHandoffsMap.set(targetLeadId, { docId: targetLeadId, branchId: branchId || null });
          } else {
            stats.failed += 1;
            console.error(`✗ Failed to create handoff for lead ${targetLeadId}: ${errMsg}`);
          }
        }
      } else {
        console.log(`DRY-RUN: Would create handoff: ${logMsg}`);
        stats.created += 1;
      }
    }

    if (auditPage.documents.length < auditPageSize) break;
    auditOffset += auditPageSize;
  }

  console.log('\n--- Backfill Summary ---');
  console.log(`Scanned logs: ${stats.scannedLogs}`);
  console.log(`Matched handoffs: ${stats.matchedHandoffs}`);
  console.log(`Already existed: ${stats.alreadyExisted}`);
  console.log(`Created/Would create: ${stats.created}`);
  console.log(`Updated/Would update branchId: ${stats.updated}`);
  console.log(`Failed: ${stats.failed}`);
  console.log(`Mode: ${APPLY ? 'APPLIED (production changes committed)' : 'DRY-RUN (pass --apply to execute)'}`);
}

main().catch((err) => {
  console.error('Backfill crashed:', err);
  process.exit(1);
});
