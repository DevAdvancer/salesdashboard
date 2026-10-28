import { createHash } from 'node:crypto';
import { Databases, ID, type Models } from 'node-appwrite';
import { COLLECTIONS, DATABASE_ID } from '@/lib/constants/appwrite';
import { isLeadReleased, leadOwnershipMayChange, leadProfileUrl } from '@/lib/utils/linkedin-lead-protection';
import { findProtectedLinkedinLead, invalidateLinkedinLeadPreviews, LinkedinLeadProtectionError, profileDocumentId, saveLeadProfileRegistry, withLinkedinProfileLock } from '@/lib/server/linkedin-lead-protection';
import { parseLeadHistory, type LeadHistorySnapshotEvent } from '@/lib/utils/lead-history-snapshot';
import { canReceiveDeactivationHandoff, type HandoffUser } from '@/lib/utils/user-deactivation';

type Row = Record<string, unknown>;
export type HistoryActor = { id: string; name: string };
export type LeadHistoryEntry = Models.Document & {
  leadId: string; requestId: string; profileUrl: string; profileKey: string; eventType: string;
  occurredAt: string; actorId: string; actorName: string; payload: string;
};

function historyValue(value: unknown, key = ''): unknown {
  if (/ssn|password|secret|token|api.?key/i.test(key)) return '[redacted]';
  if (typeof value === 'string' && value.length > 2000) return { length: value.length,
    sha256: createHash('sha256').update(value).digest('hex'), preview: value.slice(0, 250) };
  if (Array.isArray(value)) return value.length > 30 ? { count: value.length, sha256: createHash('sha256').update(JSON.stringify(value)).digest('hex') } : value.map(item => historyValue(item));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k,v]) => [k, historyValue(v,k)]));
  return value;
}

export function leadHistoryChanges(before: Row | null, after: Row | null) {
  const unpack = (row: Row | null): Row => {
    if (!row) return {};
    let data: Row = {};
    try { data = typeof row.data === 'string' ? JSON.parse(row.data) : {}; } catch { /* Raw value is retained below. */ }
    return { ...Object.fromEntries(Object.entries(row).filter(([k]) => !k.startsWith('$') && k !== 'data' && k !== 'history')), ...Object.fromEntries(Object.entries(data).map(([k,v]) => [`data.${k}`,v])) };
  };
  const left = unpack(before); const right = unpack(after);
  return Object.fromEntries([...new Set([...Object.keys(left),...Object.keys(right)])]
    .filter(key => JSON.stringify(left[key]) !== JSON.stringify(right[key]))
    .map(key => [key, { from: historyValue(left[key] ?? null,key), to: historyValue(right[key] ?? null,key) }]));
}

export async function appendLeadHistory(databases: Databases, entry: {
  leadId?: string; requestId?: string; profileUrl?: string; eventType: string;
  actor?: HistoryActor; occurredAt?: string; payload: Row; id?: string;
}) {
  const payload = JSON.stringify(entry.payload);
  if (payload.length > 60000) throw new Error('History event is too large to store safely.');
  return databases.createDocument(DATABASE_ID, COLLECTIONS.LEAD_HISTORY, entry.id || ID.unique(), {
    leadId: entry.leadId || '', requestId: entry.requestId || '', profileUrl: entry.profileUrl || '',
    profileKey: entry.profileUrl ? profileDocumentId(entry.profileUrl) : '',
    eventType: entry.eventType, occurredAt: entry.occurredAt || new Date().toISOString(),
    actorId: entry.actor?.id || 'system', actorName: entry.actor?.name || 'System', payload,
  }, []);
}

/** All active CRM lead actions use this shared admin client; lead pages/data need no changes. */
export function withLeadHistory(databases: Databases, actor: () => Promise<HistoryActor>,
  handoff?: { fromUserId: string; toUserId: string; actorId: string; leadId: string; updatedAt: string }): Databases {
  return new Proxy(databases, {
    get(target, property, receiver) {
      const method = Reflect.get(target, property, receiver);
      if (typeof method !== 'function') return method;
      if (!['createDocument','updateDocument','deleteDocument'].includes(String(property))) return method.bind(target);
      return async (...args: unknown[]) => {
        const [databaseId, collectionId, documentId, input] = args;
        if (databaseId !== DATABASE_ID || ![COLLECTIONS.LEADS,COLLECTIONS.LINKEDIN_REQUESTS].includes(String(collectionId))) {
          return method.apply(target,args);
        }
        const isLead = collectionId === COLLECTIONS.LEADS;
        const creating = property === 'createDocument';
        const deleting = property === 'deleteDocument';
        // Assign the final ID before acquiring a reservation or writing an intent event.
        if (creating && documentId === 'unique()') args[2] = ID.unique();
        const id = String(args[2]);
        const patch = input as Row | undefined;
        const before = creating ? null : await target.getDocument(String(databaseId),String(collectionId),id);
        const proposed: Row | null = deleting ? null : { ...before, ...patch, $id: id };
        const profileUrl = isLead ? leadProfileUrl(proposed?.data ?? before?.data) :
          leadProfileUrl({ linkedinProfileUrl: proposed?.targetUrl ?? before?.targetUrl });
        const eventActor = await actor();
        const event = { leadId: isLead ? id : String(proposed?.leadId || before?.leadId || ''),
          requestId: isLead ? '' : id, profileUrl: profileUrl || '', actor: eventActor };
        const operation = isLead && handoff && id === handoff.leadId ? 'LEAD_HANDOFF' : `${isLead ? 'LEAD' : 'REQUEST'}_${creating ? 'CREATE' : deleting ? 'DELETE' : 'UPDATE'}`;
        const changes = leadHistoryChanges(before,proposed);
        const intentId = ID.unique();
        const run = async () => {
          if (isLead && !creating && !deleting) {
            const fresh = await target.getDocument(String(databaseId),String(collectionId),id);
            if (fresh.$updatedAt !== before?.$updatedAt) throw new Error('This lead changed. Refresh before saving.');
            let authorizedHandoff = false;
            if (handoff && id === handoff.leadId && fresh.$updatedAt === handoff.updatedAt &&
                (fresh.ownerId === handoff.fromUserId || fresh.assignedToId === handoff.fromUserId) &&
                patch?.ownerId === handoff.toUserId && patch?.assignedToId === handoff.toUserId &&
                Object.keys(patch).every(key => ['ownerId', 'assignedToId', 'data'].includes(key))) {
              const source = await target.getDocument(DATABASE_ID, COLLECTIONS.USERS, handoff.fromUserId);
              const recipient = await target.getDocument(DATABASE_ID, COLLECTIONS.USERS, handoff.toUserId);
              const initiatingActor = await target.getDocument(DATABASE_ID, COLLECTIONS.USERS, handoff.actorId);
              authorizedHandoff = source.isActive === false && canReceiveDeactivationHandoff(
                initiatingActor as unknown as HandoffUser, source as unknown as HandoffUser, recipient as unknown as HandoffUser);
            }
            if (handoff && !authorizedHandoff) throw new Error('Handoff changed. Refresh the preview and retry.');
            if (!authorizedHandoff && !leadOwnershipMayChange(fresh,patch || {},process.env.NEXT_PUBLIC_APPWRITE_UNASSIGNED_OWNER_ID || process.env.APPWRITE_UNASSIGNED_OWNER_ID)) {
              await appendLeadHistory(target,{...event,eventType:'LEAD_OWNERSHIP_CHANGE_BLOCKED',payload:{changes}});
              throw new Error('Lead ownership is protected until the lead is marked Not Interested or Backed Out.');
            }
          }
          if (isLead && creating && profileUrl && await findProtectedLinkedinLead(target,profileUrl)) {
            await appendLeadHistory(target,{ ...event, eventType: 'DUPLICATE_LEAD_BLOCKED', payload: { attemptedLeadId:id, reason:'Existing protected LinkedIn lead', changes } });
            throw new Error('A lead already exists for this LinkedIn profile. It can only be reused after Not Interested or Backed Out.');
          }
          const reusingProfile = isLead && before && proposed &&
            (leadProfileUrl(before.data) !== profileUrl ||
              (isLeadReleased(before.status) && !isLeadReleased(proposed.status)));
          if (reusingProfile && profileUrl &&
              await findProtectedLinkedinLead(target, profileUrl, id)) {
            await appendLeadHistory(target, { ...event, eventType: 'DUPLICATE_LEAD_BLOCKED',
              payload: { changes, reason: 'Another lead protects this LinkedIn profile' } });
            throw new LinkedinLeadProtectionError('Another lead already owns this LinkedIn profile. Refresh before saving.');
          }
          if (!isLead && profileUrl && !deleting) {
            const reassignment = creating || ['agentId','accountId','targetUrl'].some(key => patch && key in patch && patch[key] !== before?.[key]);
            const resending = patch?.status === 'sent' && (before?.status !== 'sent' ||
              before?.isActive === false || ('dateSent' in patch && patch.dateSent !== before?.dateSent));
            const removesLink = patch && 'leadId' in patch && patch.leadId !== before?.leadId && !patch.leadId;
            if ((reassignment || resending || removesLink) && await findProtectedLinkedinLead(target,profileUrl)) {
              await appendLeadHistory(target,{...event,eventType:'REQUEST_CHANGE_BLOCKED',payload:{changes,reason:'Existing protected lead'}});
              throw new LinkedinLeadProtectionError('This LinkedIn profile has a protected lead. Request reassignment cannot release or replace it.');
            }
            if (patch?.leadId) {
              const linkedLead = await target.getDocument(DATABASE_ID,COLLECTIONS.LEADS,String(patch.leadId));
              if (leadProfileUrl(linkedLead.data) !== profileUrl) throw new Error('Request profile must match its linked lead.');
              if (before?.leadId && before.leadId !== patch.leadId) throw new Error('This request is already linked to another lead.');
            }
          }
          // Persist intent BEFORE the mutation, so a logging outage never permits an untracked write.
          await appendLeadHistory(target,{ ...event, id:intentId, eventType:`${operation}_ATTEMPT`, payload:{ changes } });
          if (isLead && !deleting && process.env.CRM_LEAD_HISTORY_SNAPSHOT === 'true') {
            const snapshot: LeadHistorySnapshotEvent = { id: intentId, actorId: eventActor.id, actorName: eventActor.name,
              occurredAt: new Date().toISOString(), eventType: operation, changes };
            const history = [...parseLeadHistory(before?.history), snapshot].slice(-100);
            // Keep the inline column bounded; the append-only event store retains the full archive.
            while (history.length > 1 && Buffer.byteLength(JSON.stringify(history), 'utf8') > 59000) history.shift();
            if (Buffer.byteLength(JSON.stringify(history), 'utf8') > 59000) snapshot.changes = { archive: { from: null, to: 'Open full Lead History for this event.' } };
            args[3] = { ...patch, history: JSON.stringify(history) };
            const permissions = (args[4] ?? before?.$permissions ?? []) as string[];
            args[4] = permissions.filter(permission => permission.startsWith('read('));
          } else if (isLead && patch && 'history' in patch) {
            const clean = { ...patch }; delete clean.history; args[3] = clean;
          }
          let saved;
          try { saved = await method.apply(target,args); }
          catch (error) {
            await appendLeadHistory(target,{ ...event,eventType:`${operation}_FAILED`,payload:{ intentId, code:(error as { code?:number }).code || null } });
            throw error;
          }
          if (isLead) invalidateLinkedinLeadPreviews();
          if (isLead && !deleting) await saveLeadProfileRegistry(target,saved);
          await appendLeadHistory(target,{ ...event,eventType:operation,payload:{ intentId, changes, documentUpdatedAt:saved?.$updatedAt || null } });
          return saved;
        };
        return profileUrl ? withLinkedinProfileLock(target,profileUrl,id,run) : run();
      };
    },
  });
}
