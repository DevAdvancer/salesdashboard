/** @jest-environment node */
import { listClientProgressAction, getClientProgressAction, updateClientProgressAction, createManualProgressAction, addClientProgressFeedbackAction } from '@/lib/services/client-progress-service';
import { COLLECTIONS } from '@/lib/constants/appwrite';
import { getAuthenticatedUserDoc } from '@/lib/server/current-user';
import { createAdminClient } from '@/lib/server/appwrite';
import { PROGRESS_STATUSES } from '@/lib/client-progress';
import fc from 'fast-check';
import { PROGRESS_ROLES } from '@/lib/client-progress';
import { searchProgressSalespeopleAction } from '@/lib/services/client-progress-service';

jest.mock('@/lib/server/current-user', () => ({ getAuthenticatedUserDoc: jest.fn() }));
jest.mock('@/lib/server/appwrite', () => ({ createAdminClient: jest.fn() }));
jest.mock('@/lib/services/audit-service', () => ({ logAction: jest.fn() }));
jest.mock('@/lib/server/appwrite-errors', () => ({ getAppwriteErrorMessage: jest.fn() }));
const actor = { $id: 'agent', name: 'Agent', role: 'agent', department: 'sales', isActive: true };
const baseline = { $id: 'entry', $updatedAt: 'v1', eligible: true, source: 'manual', leadId: '', candidateName: 'Client', salespersonId: 'agent', salespersonName: 'Agent', department: 'sales', progressStatus: 'New', finalFeedback: '', finalSavedAt: '', notes: '' };
let row: typeof baseline;
let locked: boolean;
let events: Map<string, any>;
const db = {
  getDocument: jest.fn(async (_d, collection, id) => {
    if (collection === COLLECTIONS.CLIENT_PROGRESS) return row;
    if (events.has(id)) return events.get(id);
    throw { code: 404 };
  }),
  listDocuments: jest.fn(async () => ({ documents: [], total: 0 })),
  createDocument: jest.fn(async (_d, collection, id, data) => {
    if (data.kind === 'lock') { if (locked) throw { code: 409 }; locked = true; }
    if (events.has(id)) throw { code: 409 };
    if (collection === COLLECTIONS.CLIENT_PROGRESS_EVENTS) events.set(id, { $id: id, ...data });
    return { $id: id, ...data };
  }),
  deleteDocument: jest.fn(async (_d, _c, id) => { locked = false; events.delete(id); }),
  updateDocument: jest.fn(async (_d, _c, _id, patch) => { row = { ...row, ...patch, $updatedAt: 'v2' }; return row; }),
};
beforeEach(() => {
  jest.clearAllMocks(); row = { ...baseline }; locked = false; events = new Map();
  (getAuthenticatedUserDoc as jest.Mock).mockResolvedValue(actor);
  (createAdminClient as jest.Mock).mockResolvedValue({ databases: { ...db, uncachedReads: { getDocument: db.getDocument, listDocuments: db.listDocuments } } });
});

test('list requests are limited to ten with actor-owned scope and exclusion predicates; never write', async () => {
  await listClientProgressAction({ filters: { search: 'Test' } });
  const queries = db.listDocuments.mock.calls[0][2].map((value: string) => JSON.parse(value));
  expect(queries).toEqual(expect.arrayContaining([
    expect.objectContaining({ method: 'limit', values: [10] }),
    expect.objectContaining({ method: 'equal', attribute: 'salespersonId', values: ['agent'] }),
    expect.objectContaining({ method: 'equal', attribute: 'eligible', values: [true] }),
    expect.objectContaining({ method: 'notEqual', attribute: 'progressStatus', values: ['Backed Out'] }),
    expect.objectContaining({ method: 'notEqual', attribute: 'progressStatus', values: ['Backout'] }),
    expect.objectContaining({ method: 'notEqual', attribute: 'progressStatus', values: ['Not Interested'] }),
    expect.objectContaining({ method: 'contains', attribute: 'candidateName', values: ['Test'] }),
  ]));
  expect(queries.some((query: { method: string }) => ['cursorAfter', 'offset', 'or'].includes(query.method))).toBe(false);
  expect(db.createDocument).not.toHaveBeenCalled(); expect(db.updateDocument).not.toHaveBeenCalled();
});

test('all Resume roles are rejected before any Client Progress database access', async () => {
  await fc.assert(fc.asyncProperty(fc.constantFrom(...PROGRESS_ROLES), async role => {
    jest.clearAllMocks();
    (getAuthenticatedUserDoc as jest.Mock).mockResolvedValue({ ...actor, role, department: 'resume' });
    await expect(listClientProgressAction()).rejects.toThrow('only available to the Sales department');
    await expect(getClientProgressAction('entry')).rejects.toThrow('only available to the Sales department');
    await expect(updateClientProgressAction({ id: 'entry', version: 'v1', patch: { notes: 'Denied' } })).rejects.toThrow('only available to the Sales department');
    expect(createAdminClient).not.toHaveBeenCalled();
  }));
});

test('legacy statuses display and filter under the new labels without migration writes', async () => {
  db.listDocuments.mockResolvedValueOnce({ documents: [{ ...baseline, progressStatus: 'On Hold' }], total: 1 });
  const result = await listClientProgressAction({ filters: { status: 'Hold' } });
  expect(result.entries[0].progressStatus).toBe('Hold');
  const queries = db.listDocuments.mock.calls[0][2].map((value: string) => JSON.parse(value));
  expect(queries).toContainEqual(expect.objectContaining({ method: 'equal', attribute: 'progressStatus', values: ['Hold', 'On Hold'] }));
  expect((await getClientProgressAction('entry')).progressStatus).toBe('New');
  expect(db.createDocument).not.toHaveBeenCalled(); expect(db.updateDocument).not.toHaveBeenCalled();
});

test.each(PROGRESS_STATUSES)('accepts the configured status %s for an authorized writer', async progressStatus => {
  row.progressStatus = progressStatus === 'New' ? 'Hold' : 'New';
  await updateClientProgressAction({ id: 'entry', version: 'v1', patch: { progressStatus } });
  expect(row.progressStatus).toBe(progressStatus);
});

test('rejects retired status labels in new edits', async () => {
  await expect(updateClientProgressAction({ id: 'entry', version: 'v1', patch: { progressStatus: 'Onboarding' } })).rejects.toThrow('Check the entered fields');
  expect(db.updateDocument).not.toHaveBeenCalled();
});

test('ten linked entries use exactly two bounded data reads, with no per-row reads or writes', async () => {
  const entries = Array.from({ length: 10 }, (_, index) => ({ ...baseline, $id: `entry${index}`, source: 'lead', leadId: `lead${index}` }));
  db.listDocuments.mockResolvedValueOnce({ documents: entries, total: 10000 })
    .mockResolvedValueOnce({ documents: entries.map(entry => ({ $id: entry.leadId, isClosed: true, status: 'Closed', assignedToId: 'agent', ownerId: 'agent' })), total: 10 });
  const result = await listClientProgressAction();
  expect(result.entries).toHaveLength(10);
  expect(result).not.toHaveProperty('nextCursor');
  expect(result).not.toHaveProperty('total');
  expect(db.listDocuments).toHaveBeenCalledTimes(2);
  expect(db.getDocument).not.toHaveBeenCalled();
  const verification = db.listDocuments.mock.calls[1][2].map((value: string) => JSON.parse(value));
  expect(verification).toEqual(expect.arrayContaining([expect.objectContaining({ method: 'limit', values: [10] })]));
  expect(db.createDocument).not.toHaveBeenCalled(); expect(db.updateDocument).not.toHaveBeenCalled();
});

test('date filters include the entire 25-hour Eastern daylight-saving transition day', async () => {
  await listClientProgressAction({ filters: { from: '2026-11-01', to: '2026-11-01' } });
  const queries = db.listDocuments.mock.calls[0][2].map((value: string) => JSON.parse(value));
  expect(queries).toEqual(expect.arrayContaining([
    expect.objectContaining({ method: 'greaterThanEqual', attribute: 'enteredAt', values: ['2026-11-01T04:00:00.000Z'] }),
    expect.objectContaining({ method: 'lessThanEqual', attribute: 'enteredAt', values: ['2026-11-02T04:59:59.999Z'] }),
  ]));
});

test.each(['recruiterName', 'marketingTl', 'salespersonId'])('an agent cannot forge an update to %s', async field => {
  await expect(updateClientProgressAction({ id: 'entry', version: 'v1', patch: { [field]: 'forged' } })).rejects.toThrow('Only');
  expect(db.updateDocument).not.toHaveBeenCalled(); expect(locked).toBe(false);
});

test('the initial final-feedback save succeeds and concurrent or subsequent non-admin edits are rejected', async () => {
  await updateClientProgressAction({ id: 'entry', version: 'v1', patch: { finalFeedback: 'First final' } });
  expect(row.finalSavedAt).toBeTruthy();
  await expect(updateClientProgressAction({ id: 'entry', version: 'v2', patch: { finalFeedback: 'Replace' } })).rejects.toThrow('Only Admin');
  expect(row.finalFeedback).toBe('First final');
  locked = true;
  await expect(updateClientProgressAction({ id: 'entry', version: 'v2', patch: { notes: 'Race' } })).rejects.toThrow('being saved');
  expect(db.updateDocument).toHaveBeenCalledTimes(1);
});

test('stale versions, out-of-scope entries and read-only roles cannot write', async () => {
  await expect(updateClientProgressAction({ id: 'entry', version: 'old', patch: { notes: 'Stale' } })).rejects.toThrow('changed');
  row.salespersonId = 'someone-else';
  await expect(updateClientProgressAction({ id: 'entry', version: 'v1', patch: { notes: 'Foreign' } })).rejects.toThrow('access denied');
  (getAuthenticatedUserDoc as jest.Mock).mockResolvedValue({ ...actor, role: 'operations' });
  await expect(updateClientProgressAction({ id: 'entry', version: 'v1', patch: { notes: 'Read only' } })).rejects.toThrow('read-only');
  expect(db.updateDocument).not.toHaveBeenCalled();
});

test('linked entries are rechecked against live lead status before writes', async () => {
  row.leadId = 'lead';
  db.getDocument.mockImplementationOnce(async () => row).mockImplementationOnce(async () => ({ $id: 'lead', isClosed: true, status: 'Not Interested' }));
  await expect(updateClientProgressAction({ id: 'entry', version: 'v1', patch: { notes: 'Write' } })).rejects.toThrow('no longer available');
  expect(db.updateDocument).not.toHaveBeenCalled();
});

test('manual creation is Admin-only and feedback retries do not duplicate events', async () => {
  await expect(createManualProgressAction({})).rejects.toThrow('Only Admin');
  const feedback = { id: 'entry', feedbackId: 'feedback-1', text: 'A first update' };
  await addClientProgressFeedbackAction(feedback); await addClientProgressFeedbackAction(feedback);
  expect([...events.values()].filter(event => event.kind === 'feedback')).toHaveLength(1);
});

test('two simultaneous initial final-feedback saves cannot overwrite one another', async () => {
  const results = await Promise.allSettled([
    updateClientProgressAction({ id: 'entry', version: 'v1', patch: { finalFeedback: 'First writer' } }),
    updateClientProgressAction({ id: 'entry', version: 'v1', patch: { finalFeedback: 'Second writer' } }),
  ]);
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
  expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
  expect(db.updateDocument).toHaveBeenCalledTimes(1);
  expect(['First writer', 'Second writer']).toContain(row.finalFeedback);
  expect(locked).toBe(false);
});

test('salesperson search includes Sales Admins in the same bounded active-user query', async () => {
  (getAuthenticatedUserDoc as jest.Mock).mockResolvedValue({ ...actor, role: 'admin' });
  db.listDocuments.mockResolvedValueOnce({ documents: [{ $id: 'sales-admin', name: 'Sales Admin', role: 'admin' }], total: 1 });
  expect(await searchProgressSalespeopleAction('Admin')).toEqual([{ id: 'sales-admin', name: 'Sales Admin', role: 'admin' }]);
  const queries = db.listDocuments.mock.calls[0][2].map((value: string) => JSON.parse(value));
  expect(queries).toEqual(expect.arrayContaining([
    expect.objectContaining({ method: 'equal', attribute: 'role', values: ['admin', 'agent', 'team_lead', 'senior_tl'] }),
    expect.objectContaining({ method: 'equal', attribute: 'department', values: ['sales'] }),
    expect.objectContaining({ method: 'notEqual', attribute: 'isActive', values: [false] }),
    expect.objectContaining({ method: 'limit', values: [10] }),
  ]));
  expect(db.listDocuments).toHaveBeenCalledTimes(1);
});

test('assignment accepts active Sales Admins while preserving role, activation and department restrictions', async () => {
  (getAuthenticatedUserDoc as jest.Mock).mockResolvedValue({ ...actor, role: 'admin' });
  await fc.assert(fc.asyncProperty(fc.constantFrom(...PROGRESS_ROLES), fc.constantFrom('sales', 'resume'), fc.boolean(), async (role, department, isActive) => {
    row = { ...baseline }; locked = false; events.clear(); db.updateDocument.mockClear();
    db.getDocument.mockImplementation(async (_database, collection, id) => {
      if (collection === COLLECTIONS.USERS) return { $id: id, name: 'Selected person', role, department, isActive };
      return row;
    });
    const action = updateClientProgressAction({ id: 'entry', version: 'v1', patch: { salespersonId: 'selected' } });
    const allowed = isActive && department === 'sales' && ['admin', 'agent', 'team_lead', 'senior_tl'].includes(role);
    if (allowed) { await action; expect(row.salespersonId).toBe('selected'); }
    else { await expect(action).rejects.toThrow('Select an active Sales'); expect(db.updateDocument).not.toHaveBeenCalled(); }
  }));
});
