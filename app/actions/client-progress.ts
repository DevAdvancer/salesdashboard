'use server';

import { Query, type Models } from 'node-appwrite';
import { z } from 'zod';
import { createAdminClient } from '@/lib/server/appwrite';
import { getAuthenticatedUserDoc } from '@/lib/server/current-user';
import { COLLECTIONS, DATABASE_ID } from '@/lib/constants/appwrite';
import { PROGRESS_PAGE_SIZE, PROGRESS_STATUSES, DEFAULT_PROGRESS_STATUS, normalizeProgressStatus, progressStatusFilterValues, canManageProgress, canManageMarketingTl, canReadAllProgress, canEditProgress, canSeeProgress, canSaveFinalFeedback, type ProgressEntry, type ProgressEvent, type ProgressSummary } from '@/lib/client-progress';
import { closedClient } from '@/lib/server/client-progress-sync';
import { withProgressLock, progressAudit, type StoredProgress } from '@/lib/server/client-progress-store';
import { resolveProgressVisibleIds } from '@/lib/server/client-progress-scope';
import { easternWallTimeToIso, getCurrentEasternIsoDate } from '@/lib/utils/eastern-date';
import { logAction } from '@/lib/services/audit-service';
import { getAppwriteErrorMessage } from '@/lib/server/appwrite-errors';
import { canShareProgress } from '@/lib/client-progress';
import { clientCardShareId, newCardToken, clientCardSubject } from '@/lib/server/client-card-security';
import { eligibleCardLead, type StoredCardShare } from '@/lib/server/public-client-card';
import type { ClientCardShareStatus } from '@/lib/client-progress-share';
import { PROGRESS_SALESPERSON_ROLES } from '@/lib/client-progress';
import { canAccessProgress } from '@/lib/client-progress';

const idSchema = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,35}$/);
const filtersSchema = z.object({
  search: z.string().trim().max(100).optional(), status: z.enum(PROGRESS_STATUSES).or(z.literal('')).optional(),
  salesperson: z.string().trim().max(100).optional(), marketingTl: z.string().trim().max(100).optional(), recruiter: z.string().trim().max(100).optional(),
  from: z.iso.date().or(z.literal('')).optional(), to: z.iso.date().or(z.literal('')).optional(),
});
const summarySelect = ['$id', '$updatedAt', 'leadId', 'source', 'candidateName', 'email', 'phone', 'salespersonId', 'salespersonName', 'department', 'marketingTl', 'recruiterName', 'progressStatus', 'enteredAt', 'assignmentOverride', 'eligible'];

async function context(adminOnly = false) {
  const actor = await getAuthenticatedUserDoc();
  if (actor.isActive === false) throw new Error('Your account is inactive.');
  if (!canAccessProgress(actor)) throw new Error('Client Progress is only available to the Sales department.');
  if (adminOnly && !canShareProgress(actor)) throw new Error('Only Admin can manage public cards.');
  const { databases } = await createAdminClient();
  // Do not use a cross-request data cache for authorization, ownership or exclusions.
  const db = Object.assign(Object.create(databases), {
    getDocument: databases.uncachedReads.getDocument,
    listDocuments: databases.uncachedReads.listDocuments,
  }) as typeof databases;
  const visibleIds = await resolveProgressVisibleIds(db, actor);
  return { actor, db, visibleIds };
}

async function checkEntry(ctx: Awaited<ReturnType<typeof context>>, id: string) {
  const entry = await ctx.db.getDocument<StoredProgress>(DATABASE_ID, COLLECTIONS.CLIENT_PROGRESS, idSchema.parse(id));
  if (!canSeeProgress(ctx.actor, entry, ctx.visibleIds)) throw new Error('Entry not found or access denied.');
  if (entry.leadId) {
    const lead = await ctx.db.getDocument(DATABASE_ID, COLLECTIONS.LEADS, entry.leadId);
    if (!closedClient(lead) || (!entry.assignmentOverride && (lead.assignedToId || lead.ownerId) !== entry.salespersonId)) {
      throw new Error('This client is no longer available. Refresh the list.');
    }
  }
  return entry;
}

async function listClientProgress(input: { filters?: unknown } = {}) {
  const filters = filtersSchema.parse(input.filters || {});
  const ctx = await context();
  const queries = [Query.equal('eligible', true), Query.notEqual('progressStatus', 'Backout'), Query.notEqual('progressStatus', 'Backed Out'), Query.notEqual('progressStatus', 'Not Interested'),
    Query.orderDesc('enteredAt'), Query.orderDesc('$id'), Query.limit(PROGRESS_PAGE_SIZE), Query.select(summarySelect)];
  queries.push(Query.equal('department', 'sales'));
  if (!canReadAllProgress(ctx.actor)) queries.push(Query.equal('salespersonId', ctx.visibleIds));
  if (filters.search) queries.push(Query.contains('candidateName', filters.search));
  if (filters.status) queries.push(Query.equal('progressStatus', progressStatusFilterValues(filters.status)));
  if (filters.salesperson) queries.push(Query.contains('salespersonName', filters.salesperson));
  if (filters.marketingTl) queries.push(Query.contains('marketingTl', filters.marketingTl));
  if (filters.recruiter) queries.push(Query.contains('recruiterName', filters.recruiter));
  if (filters.from && filters.to && filters.from > filters.to) throw new Error('The start date must be before the end date.');
  if (filters.from) queries.push(Query.greaterThanEqual('enteredAt', easternWallTimeToIso(`${filters.from}T00:00`)));
  if (filters.to) queries.push(Query.lessThanEqual('enteredAt', easternWallTimeToIso(`${filters.to}T23:59`).replace(':00.000Z', ':59.999Z')));
  const result = await ctx.db.listDocuments<Models.Document & ProgressSummary>(DATABASE_ID, COLLECTIONS.CLIENT_PROGRESS, queries);
  const ids = result.documents.filter(row => row.leadId).map(row => row.leadId);
  // One batched check for the visible page, never a read for each table row.
  const leads = ids.length ? (await ctx.db.listDocuments(DATABASE_ID, COLLECTIONS.LEADS, [Query.equal('$id', ids),
    Query.limit(PROGRESS_PAGE_SIZE), Query.select(['$id', 'isClosed', 'status', 'ownerId', 'assignedToId'])])).documents : [];
  const live = new Map(leads.map(lead => [lead.$id, lead]));
  const entries = result.documents.filter(row => {
    if (!canSeeProgress(ctx.actor, row, ctx.visibleIds)) return false;
    if (!row.leadId) return true;
    const lead = live.get(row.leadId);
    return !!lead && closedClient(lead) && (row.assignmentOverride || (lead.assignedToId || lead.ownerId) === row.salespersonId);
  });
  // One capped result only. No cursor lookup, subsequent pages, or count request.
  return { entries: entries.map(entry => ({ ...entry, progressStatus: normalizeProgressStatus(entry.progressStatus) })) };
}

async function getClientProgress(id: string) {
  const ctx = await context();
  const entry = await checkEntry(ctx, id);
  return { ...entry, progressStatus: normalizeProgressStatus(entry.progressStatus) } as ProgressEntry;
}

async function listClientProgressEvents(input: { id: string; cursor?: string; kind?: 'feedback' | 'audit'; order?: 'oldest' | 'newest' }) {
  const ctx = await context();
  await checkEntry(ctx, input.id);
  const kind = z.enum(['feedback', 'audit']).parse(input.kind || 'feedback');
  const order = z.enum(['oldest', 'newest']).parse(input.order || 'newest');
  const sort = order === 'oldest' ? Query.orderAsc : Query.orderDesc;
  const queries = [Query.equal('entryId', input.id), Query.equal('kind', kind), sort('$createdAt'), sort('$id'), Query.limit(PROGRESS_PAGE_SIZE)];
  if (input.cursor) {
    const cursor = await ctx.db.getDocument(DATABASE_ID, COLLECTIONS.CLIENT_PROGRESS_EVENTS, idSchema.parse(input.cursor));
    if (cursor.entryId !== input.id || cursor.kind !== kind) throw new Error('Invalid feedback cursor.');
    queries.push(Query.cursorAfter(input.cursor));
  }
  const result = await ctx.db.listDocuments<Models.Document & ProgressEvent>(DATABASE_ID, COLLECTIONS.CLIENT_PROGRESS_EVENTS, queries);
  return { events: result.documents, nextCursor: result.documents.length === PROGRESS_PAGE_SIZE ? result.documents.at(-1)!.$id : null };
}

async function searchProgressSalespeople(search: string) {
  const ctx = await context();
  if (!canManageProgress(ctx.actor)) throw new Error('Only Admin can assign a salesperson.');
  const term = z.string().trim().max(100).parse(search);
  const queries = [Query.equal('department', 'sales'), Query.equal('role', [...PROGRESS_SALESPERSON_ROLES]), Query.notEqual('isActive', false),
    Query.select(['$id', 'name', 'role']), Query.orderAsc('name'), Query.limit(10)];
  if (term) queries.push(Query.contains('name', term));
  const result = await ctx.db.listDocuments(DATABASE_ID, COLLECTIONS.USERS, queries);
  return result.documents.map(person => ({ id: person.$id, name: String(person.name), role: String(person.role) }));
}

async function salesperson(ctx: Awaited<ReturnType<typeof context>>, id: string) {
  const person = await ctx.db.getDocument(DATABASE_ID, COLLECTIONS.USERS, idSchema.parse(id));
  if (person.isActive === false || (person.department || 'sales') !== 'sales' || !PROGRESS_SALESPERSON_ROLES.some(role => role === person.role)) throw new Error('Select an active Sales admin, agent or team lead.');
  return { salespersonId: person.$id, salespersonName: String(person.name), department: person.department || 'sales' };
}

async function createManualProgress(input: unknown) {
  const ctx = await context();
  if (!canManageProgress(ctx.actor)) throw new Error('Only Admin can create a candidate.');
  const parsed = z.object({ id: idSchema, candidateName: z.string().trim().min(1).max(200), email: z.email().or(z.literal('')),
    phone: z.string().trim().max(80), salespersonId: idSchema, marketingTl: z.string().trim().max(200), recruiterName: z.string().trim().max(200),
    notes: z.string().trim().max(5000) }).strict().parse(input);
  if (parsed.marketingTl && !canManageMarketingTl(ctx.actor)) throw new Error('Only Sales Admin can set Marketing TL.');
  const assignment = await salesperson(ctx, parsed.salespersonId);
  const { id, ...fields } = parsed;
  await progressAudit(ctx.db, id, ctx.actor, 'CREATE_ATTEMPT', { candidateName: parsed.candidateName, salespersonId: assignment.salespersonId });
  const entry = await ctx.db.createDocument(DATABASE_ID, COLLECTIONS.CLIENT_PROGRESS, id, {
    ...fields, ...assignment, source: 'manual', leadId: '', enteredAt: new Date().toISOString(), progressStatus: DEFAULT_PROGRESS_STATUS,
    finalFeedback: '', finalSavedAt: '', marketingStartedOn: '', eligible: true, assignmentOverride: true,
  }, []).catch(async error => {
    if ((error as { code?: number }).code !== 409) throw error;
    const existing = await ctx.db.getDocument(DATABASE_ID, COLLECTIONS.CLIENT_PROGRESS, id);
    if (existing.source !== 'manual' || existing.candidateName !== fields.candidateName || existing.email !== fields.email ||
      existing.phone !== fields.phone || existing.salespersonId !== assignment.salespersonId) throw error;
    return existing; // Retry after a lost response; never create a duplicate or overwrite edits.
  });
  await progressAudit(ctx.db, id, ctx.actor, 'CREATE', { candidateName: parsed.candidateName, salespersonId: assignment.salespersonId });
  return entry.$id;
}

async function updateClientProgress(input: unknown) {
  const parsed = z.object({ id: idSchema, version: z.string().min(1), patch: z.object({
    progressStatus: z.enum(PROGRESS_STATUSES).optional(), notes: z.string().trim().max(5000).optional(),
    marketingTl: z.string().trim().max(200).optional(), recruiterName: z.string().trim().max(200).optional(),
    marketingStartedOn: z.iso.date().or(z.literal('')).optional(),
    salespersonId: idSchema.optional(), finalFeedback: z.string().trim().min(1).max(5000).optional(),
  }).strict() }).strict().parse(input);
  const ctx = await context();
  if (!canEditProgress(ctx.actor)) throw new Error('Your role has read-only access to Client Progress.');
  return withProgressLock(ctx.db, parsed.id, async () => {
    const current = await checkEntry(ctx, parsed.id);
    if (current.$updatedAt !== parsed.version) throw new Error('This entry changed. Refresh before saving.');
    const patch: Record<string, unknown> = { ...parsed.patch };
    if (('salespersonId' in patch || 'recruiterName' in patch) && !canManageProgress(ctx.actor)) throw new Error('Only Admin can change the salesperson or recruiter.');
    if ('marketingTl' in patch && !canManageMarketingTl(ctx.actor)) throw new Error('Only Sales Admin can change Marketing TL.');
    if ('marketingStartedOn' in patch && !canManageProgress(ctx.actor)) throw new Error('Only Admin can change the marketing start date.');
    if (patch.progressStatus === 'Marketing in progress' && !current.marketingStartedOn && !('marketingStartedOn' in patch)) patch.marketingStartedOn = getCurrentEasternIsoDate();
    if ('finalFeedback' in patch) {
      if (!canSaveFinalFeedback(ctx.actor, !!current.finalSavedAt)) throw new Error('Only Admin can edit final feedback after its first save.');
      patch.finalSavedAt = current.finalSavedAt || new Date().toISOString();
    }
    if (typeof patch.salespersonId === 'string') Object.assign(patch, await salesperson(ctx, patch.salespersonId), { assignmentOverride: true });
    const changes = Object.fromEntries(Object.entries(patch).filter(([key, value]) => current[key] !== value).map(([key, value]) => [key, { from: current[key], to: value }]));
    if (!Object.keys(changes).length) return;
    await progressAudit(ctx.db, parsed.id, ctx.actor, 'UPDATE_ATTEMPT', changes);
    await ctx.db.updateDocument(DATABASE_ID, COLLECTIONS.CLIENT_PROGRESS, parsed.id, patch);
    await progressAudit(ctx.db, parsed.id, ctx.actor, 'UPDATE', changes);
    await logAction({ actorId: ctx.actor.$id, actorName: ctx.actor.name, action: 'LEAD_UPDATE', targetId: parsed.id, targetType: 'client_progress', metadata: { fields: Object.keys(changes) } });
  });
}

async function addClientProgressFeedback(input: unknown) {
  const parsed = z.object({ id: idSchema, feedbackId: idSchema, text: z.string().trim().min(1).max(5000) }).strict().parse(input);
  const ctx = await context();
  if (!canEditProgress(ctx.actor)) throw new Error('Your role has read-only access to Client Progress.');
  return withProgressLock(ctx.db, parsed.id, async () => {
  await checkEntry(ctx, parsed.id);
  try {
    await ctx.db.createDocument(DATABASE_ID, COLLECTIONS.CLIENT_PROGRESS_EVENTS, parsed.feedbackId, {
      entryId: parsed.id, kind: 'feedback', text: parsed.text, authorId: ctx.actor.$id, authorName: ctx.actor.name,
    }, []);
  } catch (error) {
    if ((error as { code?: number }).code === 409) {
      const existing = await ctx.db.getDocument(DATABASE_ID, COLLECTIONS.CLIENT_PROGRESS_EVENTS, parsed.feedbackId);
      if (existing.entryId === parsed.id && existing.authorId === ctx.actor.$id && existing.kind === 'feedback' && existing.text === parsed.text) return;
    }
    getAppwriteErrorMessage(error);
    throw new Error('Could not save feedback. Please retry.');
  }
  });
}

// Expected errors travel as data so production Next.js does not replace them with
// a generic Server Components digest. Native SDK details never reach the browser.
async function result<T>(operation: () => Promise<T>) {
  try { return { ok: true as const, data: await operation() }; }
  catch (error) {
    if (error instanceof z.ZodError) return { ok: false as const, error: 'Check the entered fields and try again.' };
    if (typeof (error as { code?: unknown })?.code === 'number') {
      getAppwriteErrorMessage(error);
      return { ok: false as const, error: 'Could not complete the request. Refresh and try again.' };
    }
    return { ok: false as const, error: error instanceof Error ? error.message : 'Could not complete the request.' };
  }
}
export async function listClientProgressAction(input: Parameters<typeof listClientProgress>[0] = {}) { return result(() => listClientProgress(input)); }
export async function getClientProgressAction(id: string) { return result(() => getClientProgress(id)); }
export async function listClientProgressEventsAction(input: Parameters<typeof listClientProgressEvents>[0]) { return result(() => listClientProgressEvents(input)); }
export async function searchProgressSalespeopleAction(search: string) { return result(() => searchProgressSalespeople(search)); }
export async function createManualProgressAction(input: unknown) { return result(() => createManualProgress(input)); }
export async function updateClientProgressAction(input: unknown) { return result(() => updateClientProgress(input)); }
export async function addClientProgressFeedbackAction(input: unknown) { return result(() => addClientProgressFeedback(input)); }

async function cardShareStatus(id: string): Promise<ClientCardShareStatus> {
  const ctx = await context(true);
  if (!canShareProgress(ctx.actor)) throw new Error('Only Admin can manage public cards.');
  await checkEntry(ctx, idSchema.parse(id));
  try {
    const share = await ctx.db.getDocument<StoredCardShare>(DATABASE_ID, COLLECTIONS.CLIENT_PROGRESS_SHARES, clientCardShareId(id));
    return { active: !share.revoked && Date.parse(share.expiresAt) > Date.now(), expiresAt: share.expiresAt, includeContact: share.includeContact, includeNotes: share.includeNotes };
  } catch (error) {
    if ((error as { code?: number }).code !== 404) throw error;
    return { active: false, expiresAt: null, includeContact: false, includeNotes: false };
  }
}
async function publishClientCard(input: unknown) {
  const parsed = z.object({ id: idSchema, days: z.union([z.literal(1), z.literal(7), z.literal(30)]), includeContact: z.boolean(), includeNotes: z.boolean() }).strict().parse(input);
  const ctx = await context(true);
  if (!canShareProgress(ctx.actor)) throw new Error('Only Admin can publish public cards.');
  return withProgressLock(ctx.db, parsed.id, async () => {
    const entry = await ctx.db.getDocument<StoredProgress>(DATABASE_ID, COLLECTIONS.CLIENT_PROGRESS, parsed.id);
    if (!canSeeProgress(ctx.actor, entry, ctx.visibleIds)) throw new Error('Client unavailable.');
    const lead = await eligibleCardLead(ctx.db, entry);
    const token = newCardToken(entry.$id);
    const expiresAt = new Date(Date.now() + parsed.days * 86_400_000).toISOString();
    const options = { includeContact: parsed.includeContact, includeNotes: parsed.includeNotes, expiresAt };
    await progressAudit(ctx.db, entry.$id, ctx.actor, 'SHARE_PUBLISH_ATTEMPT', options);
    const data = { entryId: entry.$id, tokenHash: token.tokenHash, subjectHash: clientCardSubject(entry, lead), issuerId: ctx.actor.$id, revoked: false, ...options };
    try { await ctx.db.updateDocument(DATABASE_ID, COLLECTIONS.CLIENT_PROGRESS_SHARES, token.id, data, []); }
    catch (error) {
      if ((error as { code?: number }).code !== 404) throw error;
      await ctx.db.createDocument(DATABASE_ID, COLLECTIONS.CLIENT_PROGRESS_SHARES, token.id, data, []);
    }
    await progressAudit(ctx.db, entry.$id, ctx.actor, 'SHARE_PUBLISH', options);
    return { path: `/share/client#${token.token}`, expiresAt };
  });
}
async function revokeClientCard(id: string) {
  idSchema.parse(id);
  const ctx = await context(true);
  if (!canShareProgress(ctx.actor)) throw new Error('Only Admin can revoke public cards.');
  return withProgressLock(ctx.db, id, async () => {
    await progressAudit(ctx.db, id, ctx.actor, 'SHARE_REVOKE_ATTEMPT', {});
    try { await ctx.db.updateDocument(DATABASE_ID, COLLECTIONS.CLIENT_PROGRESS_SHARES, clientCardShareId(id), { revoked: true }, []); }
    catch (error) { if ((error as { code?: number }).code !== 404) throw error; }
    await progressAudit(ctx.db, id, ctx.actor, 'SHARE_REVOKE', {});
  });
}
export async function getClientCardShareStatusAction(id: string) { return result(() => cardShareStatus(id)); }
export async function publishClientCardAction(input: unknown) { return result(() => publishClientCard(input)); }
export async function revokeClientCardAction(id: string) { return result(() => revokeClientCard(id)); }
