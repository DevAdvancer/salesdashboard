'use server';

import { Query } from 'node-appwrite';
import { createAdminClient } from '@/lib/server/appwrite';
import { getAuthenticatedUserDoc } from '@/lib/server/current-user';
import { getLeadAction } from '@/app/actions/lead/queries';
import { COLLECTIONS, DATABASE_ID } from '@/lib/constants/appwrite';
import type { LeadHistoryEntry } from '@/lib/server/lead-history';
import { leadProfileUrl } from '@/lib/utils/linkedin-lead-protection';
import { profileDocumentId } from '@/lib/server/linkedin-lead-protection';

export async function getLinkedinLeadHistoryAction(input: { leadId: string; before?: string }) {
  const actor = await getAuthenticatedUserDoc();
  if (actor.isActive === false || (actor.department || 'sales') !== 'sales') throw new Error('Unauthorized');
  // Reuse the full department, role, ownership and team visibility checks.
  const lead = await getLeadAction(input.leadId,actor.$id);
  const profileUrl = leadProfileUrl(lead.data);
  const { databases } = await createAdminClient();
  databases.clearReadCacheForCollection(COLLECTIONS.LEAD_HISTORY);
  const response = await databases.listDocuments(DATABASE_ID,COLLECTIONS.LEAD_HISTORY,[
    profileUrl ? Query.or([Query.equal('leadId',lead.$id),Query.equal('profileKey',profileDocumentId(profileUrl))]) : Query.equal('leadId',lead.$id),
    Query.orderDesc('$sequence'),Query.limit(100),...(input.before ? [Query.cursorAfter(input.before)] : []),
  ]);
  const rows = response.documents as unknown as LeadHistoryEntry[];
  return { rows, next:rows.length === 100 ? rows[rows.length-1].$id : null };
}
