import { createHash } from 'node:crypto';
import { Databases, ID, type Models } from 'node-appwrite';
import { COLLECTIONS, DATABASE_ID } from '@/lib/constants/appwrite';
import { leadOwnershipMayChange, leadProfileUrl } from '@/lib/utils/linkedin-lead-protection';
import { findProtectedLinkedinLead, profileDocumentId, saveLeadProfileRegistry, withLinkedinProfileLock } from '@/lib/server/linkedin-lead-protection';

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
    return { ...Object.fromEntries(Object.entries(row).filter(([k]) => !k.startsWith('$') && k !== 'data')), ...Object.fromEntries(Object.entries(data).map(([k,v]) => [`data.${k}`,v])) };
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
export function withLeadHistory(databases: Databases, actor: () => Promise<HistoryActor>): Databases {
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
        const operation = `${isLead ? 'LEAD' : 'REQUEST'}_${creating ? 'CREATE' : deleting ? 'DELETE' : 'UPDATE'}`;
        const changes = leadHistoryChanges(before,proposed);
        const intentId = ID.unique();
        const run = async () => {
          if (isLead && !creating && !deleting) {
            const fresh = await target.getDocument(String(databaseId),String(collectionId),id);
            if (fresh.$updatedAt !== before?.$updatedAt) throw new Error('This lead changed. Refresh before saving.');
            if (!leadOwnershipMayChange(fresh,patch || {},process.env.NEXT_PUBLIC_APPWRITE_UNASSIGNED_OWNER_ID || process.env.APPWRITE_UNASSIGNED_OWNER_ID)) {
              await appendLeadHistory(target,{...event,eventType:'LEAD_OWNERSHIP_CHANGE_BLOCKED',payload:{changes}});
              throw new Error('Lead ownership is protected until the lead is marked Not Interested or Backed Out.');
            }
          }
          if (isLead && creating && profileUrl && await findProtectedLinkedinLead(target,profileUrl)) {
            await appendLeadHistory(target,{ ...event, eventType: 'DUPLICATE_LEAD_BLOCKED', payload: { attemptedLeadId:id, reason:'Existing protected LinkedIn lead', changes } });
            throw new Error('A lead already exists for this LinkedIn profile. It can only be reused after Not Interested or Backed Out.');
          }
          if (!isLead && profileUrl && !deleting) {
            const reassignment = creating || ['agentId','accountId','targetUrl'].some(key => patch && key in patch && patch[key] !== before?.[key]);
            const removesLink = patch && 'leadId' in patch && patch.leadId !== before?.leadId && !patch.leadId;
            if ((reassignment || removesLink) && await findProtectedLinkedinLead(target,profileUrl)) {
              await appendLeadHistory(target,{...event,eventType:'REQUEST_CHANGE_BLOCKED',payload:{changes,reason:'Existing protected lead'}});
              throw new Error('This LinkedIn profile has a protected lead. Request reassignment cannot release or replace it.');
            }
            if (patch?.leadId) {
              const linkedLead = await target.getDocument(DATABASE_ID,COLLECTIONS.LEADS,String(patch.leadId));
              if (leadProfileUrl(linkedLead.data) !== profileUrl) throw new Error('Request profile must match its linked lead.');
              if (before?.leadId && before.leadId !== patch.leadId) throw new Error('This request is already linked to another lead.');
            }
          }
          // Persist intent BEFORE the mutation, so a logging outage never permits an untracked write.
          await appendLeadHistory(target,{ ...event, id:intentId, eventType:`${operation}_ATTEMPT`, payload:{ changes } });
          let saved;
          try { saved = await method.apply(target,args); }
          catch (error) {
            await appendLeadHistory(target,{ ...event,eventType:`${operation}_FAILED`,payload:{ intentId, code:(error as { code?:number }).code || null } });
            throw error;
          }
          if (isLead && !deleting) await saveLeadProfileRegistry(target,saved);
          await appendLeadHistory(target,{ ...event,eventType:operation,payload:{ intentId, changes, documentUpdatedAt:saved?.$updatedAt || null } });
          return saved;
        };
        return profileUrl ? withLinkedinProfileLock(target,profileUrl,id,run) : run();
      };
    },
  });
}
