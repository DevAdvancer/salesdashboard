'use server';

import { Query } from 'node-appwrite';
import { createAdminClient } from '@/lib/server/appwrite';
import { COLLECTIONS } from '@/lib/constants/appwrite';
import type { LgHandoff } from '@/lib/types';

const DATABASE_ID = process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID!;
const LG_HANDOFFS_COLLECTION_ID = COLLECTIONS.LG_HANDOFFS;
const USERS_COLLECTION_ID = COLLECTIONS.USERS;

function isNotFoundError(error: unknown) {
  const code = (error as { code?: number } | null | undefined)?.code;
  const message = error instanceof Error ? error.message : String(error);
  return code === 404 || message.includes('not found');
}

function isConflictError(error: unknown) {
  const code = (error as { code?: number } | null | undefined)?.code;
  return code === 409;
}

interface RecordLgHandoffInput {
  leadId: string;
  teamLeadId: string;
  leadGenerationId: string;
  branchId?: string | null;
}

/**
 * Records a one-time handoff of a lead from a lead_generation actor to
 * a Team Lead. The row is keyed on `leadId` (unique) and is NEVER
 * updated or deleted by later reassignments — that is the whole point.
 * If the lead was reassigned from TL A to TL B, the row still points
 * to TL A, which is exactly what the "Lead Gen Team Handoffs"
 * dashboard wants.
 *
 * The Sales-only scope (LG and TL must both be on the Sales
 * department) is enforced server-side so callers don't have to
 * remember the rule. If you call this from a path that might pass a
 * Resume LG / TL pair, expect a silent no-op rather than an error —
 * those rows do not belong in this collection.
 *
 * Returns the resulting row, or null if no row was written
 * (e.g. the caller passed a non-Sales pair, or the lead already has
 * a handoff row).
 */
export async function recordLgHandoffAction(
  input: RecordLgHandoffInput,
): Promise<LgHandoff | null> {
  const leadId = String(input.leadId ?? '').trim();
  const teamLeadId = String(input.teamLeadId ?? '').trim();
  const leadGenerationId = String(input.leadGenerationId ?? '').trim();
  if (!leadId || !teamLeadId || !leadGenerationId) {
    return null;
  }

  const { databases } = await createAdminClient();

  // Sales-only scope: read the two users' departments in one round
  // trip and reject the call before it ever hits lg_handoffs. This
  // keeps the collection clean — no rows for cross-team assignments
  // that the Sales dashboard would later have to filter out.
  const userResponse = await databases.listDocuments(
    DATABASE_ID,
    USERS_COLLECTION_ID,
    [
      Query.equal('$id', [teamLeadId, leadGenerationId]),
      Query.limit(10),
      Query.select(['$id', 'department']),
    ],
  );
  const deptById = new Map<string, string>();
  for (const doc of userResponse.documents) {
    const id = String((doc as { $id?: unknown }).$id ?? '');
    if (!id) continue;
    deptById.set(
      id,
      String((doc as { department?: unknown }).department ?? 'sales'),
    );
  }
  if (deptById.get(teamLeadId) !== 'sales') return null;
  if (deptById.get(leadGenerationId) !== 'sales') return null;

  const handedOffAt = new Date().toISOString();
  const payload = {
    leadId,
    teamLeadId,
    leadGenerationId,
    handedOffAt,
    branchId: input.branchId ?? null,
  };

  // Use `leadId` as the document id so the unique index on `leadId`
  // is double-protected against a duplicate-handoff race. If another
  // caller already wrote a row for this lead, the create returns 409
  // and we treat that as success: the original handoff row is still
  // the one we want to keep.
  try {
    const created = await databases.createDocument(
      DATABASE_ID,
      LG_HANDOFFS_COLLECTION_ID,
      leadId,
      payload,
    );
    return created as unknown as LgHandoff;
  } catch (error: unknown) {
    if (isConflictError(error)) {
      // Row already exists from an earlier handoff. Read it back so
      // the caller can confirm what was persisted.
      try {
        const existing = await databases.getDocument(
          DATABASE_ID,
          LG_HANDOFFS_COLLECTION_ID,
          leadId,
        );
        return existing as unknown as LgHandoff;
      } catch (readError: unknown) {
        if (isNotFoundError(readError)) return null;
        throw readError;
      }
    }
    if (isNotFoundError(error)) {
      // Collection not provisioned yet — surface a clear error so the
      // setup script can run before this is called in anger.
      throw new Error(
        'lg_handoffs collection is missing. Run `bun run setup:appwrite` to provision it.',
      );
    }
    throw error;
  }
}

/**
 * Reads every row in lg_handoffs. The dashboard reads these directly
 * to render the "Lead Gen Team Handoffs" table — the count grouped by
 * teamLeadId is the per-TL handoff total, which is exact by
 * construction (no row is ever updated or deleted).
 *
 * If the collection is missing, returns an empty array so the
 * dashboard renders an empty-state instead of crashing.
 */
export async function listLgHandoffsAction(): Promise<LgHandoff[]> {
  const { databases } = await createAdminClient();

  try {
    const response = await databases.listDocuments(
      DATABASE_ID,
      LG_HANDOFFS_COLLECTION_ID,
      [
        Query.limit(5000),
        Query.select(['leadId', 'teamLeadId', 'leadGenerationId', 'handedOffAt', 'branchId']),
      ],
    );
    const rows: LgHandoff[] = [];
    for (const doc of response.documents) {
      const leadId = String((doc as { leadId?: unknown }).leadId ?? '').trim();
      const teamLeadId = String(
        (doc as { teamLeadId?: unknown }).teamLeadId ?? '',
      ).trim();
      const leadGenerationId = String(
        (doc as { leadGenerationId?: unknown }).leadGenerationId ?? '',
      ).trim();
      const handedOffAt = String(
        (doc as { handedOffAt?: unknown }).handedOffAt ?? '',
      );
      const branchId =
        (doc as { branchId?: unknown }).branchId == null
          ? null
          : String((doc as { branchId?: unknown }).branchId);
      if (!leadId || !teamLeadId || !leadGenerationId) continue;
      rows.push({
        $id: String((doc as { $id?: unknown }).$id ?? leadId),
        leadId,
        teamLeadId,
        leadGenerationId,
        handedOffAt,
        branchId,
        $createdAt: (doc as { $createdAt?: string }).$createdAt,
        $updatedAt: (doc as { $updatedAt?: string }).$updatedAt,
      });
    }
    return rows;
  } catch (error: unknown) {
    if (isNotFoundError(error)) return [];
    throw error;
  }
}
