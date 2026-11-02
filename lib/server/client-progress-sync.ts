import { createHash } from 'node:crypto';
import { type Databases, type Models } from 'node-appwrite';
import { COLLECTIONS, DATABASE_ID } from '@/lib/constants/appwrite';
import { isVisibleClientLead } from '@/lib/utils/client-history';
import { DEFAULT_PROGRESS_STATUS, type ProgressEntry } from '@/lib/client-progress';
import { withProgressLock } from '@/lib/server/client-progress-store';

type LeadRow = Models.Document & { isClosed?: boolean; status?: string; data?: string; ownerId?: string; assignedToId?: string; closedAt?: string };
export function progressId(leadId: string) { return `l_${createHash('sha256').update(leadId).digest('hex').slice(0, 32)}`; }
export function closedClient(row: LeadRow | null) { return !!row && isVisibleClientLead({ isClosed: row.isClosed === true, status: row.status || '' }); }
function leadFields(row: LeadRow | null) {
  let data: Record<string, unknown> = {};
  try { data = JSON.parse(row?.data || '{}'); } catch { /* Legacy malformed data. */ }
  return { visible: closedClient(row), ownerId: row?.ownerId, assignedToId: row?.assignedToId,
    fields: ['name', 'firstName', 'lastName', 'fullName', 'candidateName', 'clientName', 'email', 'emailAddress', 'phone', 'phoneNumber', 'mobile'].map(key => data[key]) };
}

/** Runs only after a relevant lead mutation. Never called by page reads or a timer. */
export async function syncClientProgress(databases: Databases, before: LeadRow | null, after: LeadRow | null) {
  if (!closedClient(before) && !closedClient(after)) return;
  if (before && after && JSON.stringify(leadFields(before)) === JSON.stringify(leadFields(after))) return;
  const lead = after || before!;
  const id = progressId(lead.$id);
  return withProgressLock(databases, id, async () => {
  let existing: (Models.Document & ProgressEntry) | null = null;
  try { existing = await databases.getDocument<Models.Document & ProgressEntry>(DATABASE_ID, COLLECTIONS.CLIENT_PROGRESS, id); }
  catch (error) { if ((error as { code?: number }).code !== 404) throw error; }
  if (!closedClient(after)) {
    if (existing?.eligible) await databases.updateDocument(DATABASE_ID, COLLECTIONS.CLIENT_PROGRESS, id, { eligible: false });
    return;
  }
  let data: Record<string, unknown> = {};
  try { data = JSON.parse(after!.data || '{}'); } catch { /* Keep the entry usable for legacy leads. */ }
  const text = (...keys: string[]) => { for (const key of keys) if (typeof data[key] === 'string' && data[key]) return String(data[key]); return ''; };
  const salespersonId = existing?.assignmentOverride ? existing.salespersonId : after!.assignedToId || after!.ownerId || '';
  const person = await databases.getDocument(DATABASE_ID, COLLECTIONS.USERS, salespersonId).catch(error => {
    if ((error as { code?: number }).code !== 404) throw error;
    return { name: text('closedByName', 'salesperson') || 'Former Sales user', department: 'sales' };
  });
  const sourceFields = {
    leadId: lead.$id, source: 'lead', candidateName: (text('name', 'fullName', 'candidateName', 'clientName') || `${text('firstName')} ${text('lastName')}`.trim() || 'Unnamed client').slice(0, 200),
    email: text('email', 'emailAddress').slice(0, 320), phone: text('phone', 'phoneNumber', 'mobile').slice(0, 80),
    salespersonId, salespersonName: String(person.name || '').slice(0, 200), department: person.department || 'sales',
    eligible: true,
  };
  if (existing) {
    const patch = Object.fromEntries(Object.entries(sourceFields).filter(([key, value]) => existing![key as keyof ProgressEntry] !== value));
    if (Object.keys(patch).length) await databases.updateDocument(DATABASE_ID, COLLECTIONS.CLIENT_PROGRESS, id, patch);
  } else {
    await databases.createDocument(DATABASE_ID, COLLECTIONS.CLIENT_PROGRESS, id, {
      ...sourceFields, enteredAt: after!.closedAt || after!.$createdAt, marketingTl: '', recruiterName: '',
      progressStatus: DEFAULT_PROGRESS_STATUS, notes: '', finalFeedback: '', finalSavedAt: '', marketingStartedOn: '', assignmentOverride: false,
    }, []).catch(error => { if ((error as { code?: number }).code !== 409) throw error; });
  }
  });
}
