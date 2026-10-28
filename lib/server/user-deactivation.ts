import { createHash } from 'node:crypto';
import { Permission, Query, Role } from 'node-appwrite';
import { createAdminClient } from '@/lib/server/appwrite';
import { listAllDocuments } from '@/lib/server/appwrite-pagination';
import { COLLECTIONS, DATABASE_ID } from '@/lib/constants/appwrite';
import { canDeactivateUser, canReceiveDeactivationHandoff, type HandoffUser } from '@/lib/utils/user-deactivation';
import type { Lead, LinkedinAccount } from '@/lib/types';
import { parseLeadHistory } from '@/lib/utils/lead-history-snapshot';
import { listDeactivationLinkedinRequests } from '@/lib/server/deactivation-linkedin-requests';

type Database = Awaited<ReturnType<typeof createAdminClient>>['databases'];

export async function planUserDeactivation(databases: Database, actorId: string, sourceId: string, recipientId?: string) {
  // Never use settled reference caches for authorization or a mutation preview.
  for (const collection of [COLLECTIONS.USERS, COLLECTIONS.LEADS, COLLECTIONS.LINKEDIN_ACCOUNTS, COLLECTIONS.LINKEDIN_REQUESTS]) {
    databases.clearReadCacheForCollection(collection);
  }
  const actor = await databases.getDocument(DATABASE_ID, COLLECTIONS.USERS, actorId) as unknown as HandoffUser;
  const source = await databases.getDocument(DATABASE_ID, COLLECTIONS.USERS, sourceId) as unknown as HandoffUser;
  if (!canDeactivateUser(actor, source)) throw new Error('Permission denied: You cannot inactivate this user.');
  const list = <T>(collectionId: string, queries: string[]) => listAllDocuments<T>({
    databases, databaseId: DATABASE_ID, collectionId, queries, requireComplete: true,
  });
  const leads = await list<Lead>(COLLECTIONS.LEADS, [Query.or([Query.equal('ownerId', sourceId), Query.equal('assignedToId', sourceId)])]);
  const accounts = await list<LinkedinAccount>(COLLECTIONS.LINKEDIN_ACCOUNTS, [Query.equal('assignedUserId', sourceId)]);
  const requests = await listDeactivationLinkedinRequests(databases, sourceId, accounts.map(account => account.$id));
  const recipients = (await list<HandoffUser>(COLLECTIONS.USERS, []))
    .filter(candidate => canReceiveDeactivationHandoff(actor, source, candidate));
  const recipient = recipients.find(candidate => candidate.$id === (recipientId || actorId))
    || (!recipientId ? recipients[0] : undefined);
  if (leads.length && !recipient) throw new Error('Choose an active Sales user to receive all leads.');
  if (recipientId && !recipient) throw new Error('Permission denied: Invalid handoff recipient.');
  // Bind the confirmation to the exact records and recipient, including closed leads.
  const fingerprint = (rows: Array<{ $id: string; $updatedAt?: string }>) =>
    rows.map(row => [row.$id, row.$updatedAt]).sort((a, b) => a[0]!.localeCompare(b[0]!));
  const hash = createHash('sha256').update(JSON.stringify({ actor, source, recipient,
    leads: fingerprint(leads), accounts: fingerprint(accounts), requests: fingerprint(requests) })).digest('hex');
  return { actor, source, recipient, recipients, leads, accounts, requests, hash };
}

export async function handoffDeactivatedUserLeads(plan: Awaited<ReturnType<typeof planUserDeactivation>>, maxLeads = plan.leads.length) {
  if (!plan.leads.length || !plan.recipient) return 0;
  const recipient = plan.recipient;
  // This context is constructed only on the server after authorization and disabling login.
  const { databases } = await createAdminClient();
  let transferred = 0;
  for (const planned of plan.leads.slice(0, maxLeads)) {
    databases.clearReadCacheForCollection(COLLECTIONS.LEADS);
    const lead = await databases.getDocument(DATABASE_ID, COLLECTIONS.LEADS, planned.$id) as unknown as Lead;
    if (lead.ownerId !== plan.source.$id && lead.assignedToId !== plan.source.$id) continue;
    if (!lead.$updatedAt) throw new Error('Lead version is missing. Refresh before handing off.');
    // Fail on malformed business data rather than discarding it during a handoff.
    const data = JSON.parse(lead.data);
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error(`Lead ${lead.$id} has invalid data.`);
    let creatorId = typeof data.creatorId === 'string' && data.creatorId ? data.creatorId : undefined;
    let creatorName = data.creatorName;
    let creatorAttribution = data.creatorAttribution;
    if (!creatorId) {
      const created = parseLeadHistory(lead.history).find(event => event.eventType === 'LEAD_CREATE');
      if (created) { creatorId = created.actorId; creatorName = created.actorName; }
      else {
        const archived = await databases.listDocuments(DATABASE_ID, COLLECTIONS.LEAD_HISTORY,
          [Query.equal('leadId', lead.$id), Query.equal('eventType', 'LEAD_CREATE'), Query.limit(1)]);
        const creation = archived.documents[0];
        if (creation) { creatorId = creation.actorId; creatorName = creation.actorName; }
      }
      // Legacy records without creation evidence retain the original recorded owner,
      // explicitly labelled as such rather than inventing a creator.
      if (!creatorId) { creatorId = lead.ownerId; creatorAttribution = 'original_owner'; }
    }
    const ids = [...new Set([creatorId, lead.ownerId, lead.assignedToId].filter(Boolean))] as string[];
    const names: Record<string, string> = {};
    for (const id of ids) {
      try { names[id] = String((await databases.getDocument(DATABASE_ID, COLLECTIONS.USERS, id)).name || id); }
      catch (error) { if ((error as { code?: number }).code !== 404) throw error; names[id] = id; }
    }
    const handoff = { fromUserId: plan.source.$id, fromUserName: plan.source.name,
      previousOwnerId: lead.ownerId, previousOwnerName: names[lead.ownerId],
      previousAssigneeId: lead.assignedToId || null, previousAssigneeName: names[lead.assignedToId || ''] || null,
      toUserId: recipient.$id, toUserName: recipient.name,
      actorId: plan.actor.$id, actorName: plan.actor.name, occurredAt: new Date().toISOString() };
    const scoped = await createAdminClient({ deactivationHandoff: { fromUserId: plan.source.$id,
      toUserId: recipient.$id, actorId: plan.actor.$id, leadId: lead.$id, updatedAt: lead.$updatedAt } });
    await scoped.databases.updateDocument(DATABASE_ID, COLLECTIONS.LEADS, lead.$id, {
      ownerId: recipient.$id, assignedToId: recipient.$id,
      data: JSON.stringify({ ...data, creatorId, creatorName: creatorName || names[creatorId!], creatorAttribution, deactivationHandoff: handoff }),
    }, [...new Set([...(lead.$permissions || []).filter(p => p.startsWith('read(')), Permission.read(Role.user(recipient.$id))])]);
    transferred++;
  }
  return transferred;
}
