/** @jest-environment node */
import { syncClientProgress } from '@/lib/server/client-progress-sync';
import { COLLECTIONS } from '@/lib/constants/appwrite';
import type { Databases, Models } from 'node-appwrite';

function database() {
  const records = new Map<string, any>();
  records.set('salesperson', { $id: 'salesperson', name: 'Agent', department: 'sales' });
  const db = { getDocument: jest.fn(async (_d, _c, id) => { if (!records.has(id)) throw { code: 404 }; return records.get(id); }),
    createDocument: jest.fn(async (_d, collection, id, data) => { if (records.has(id)) throw { code: 409 }; const row = { $id: id, ...data }; records.set(id, row); return row; }),
    updateDocument: jest.fn(async (_d, _c, id, data) => { const row = { ...records.get(id), ...data }; records.set(id, row); return row; }),
    deleteDocument: jest.fn(async (_d, _c, id) => { records.delete(id); }) };
  return { db, records };
}
const lead = { $id: 'lead', isClosed: true, status: 'Closed', ownerId: 'salesperson', assignedToId: 'salesperson', closedAt: '2026-11-01T12:00:00Z', $createdAt: '2026-10-01T12:00:00Z', data: JSON.stringify({ firstName: 'Test', lastName: 'Client', email: 'test@example.com' }) } as unknown as Models.Document;

test('non-client leads and unrelated closed-lead updates cost zero projection reads or writes', async () => {
  const { db } = database();
  await syncClientProgress(db as unknown as Databases, null, { ...lead, isClosed: false });
  await syncClientProgress(db as unknown as Databases, lead, { ...lead, nextFollowUpAt: '2026-11-03' });
  await syncClientProgress(db as unknown as Databases, lead, { ...lead, data: JSON.stringify({ ...JSON.parse(lead.data), paymentNote: 'Paid' }) });
  expect(db.getDocument).not.toHaveBeenCalled(); expect(db.createDocument).not.toHaveBeenCalled(); expect(db.updateDocument).not.toHaveBeenCalled();
});

test('creates once, combines first/last names and preserves operational edits during source updates', async () => {
  const { db, records } = database();
  await syncClientProgress(db as unknown as Databases, null, lead);
  const created = db.createDocument.mock.calls.find(([, collection]) => collection === COLLECTIONS.CLIENT_PROGRESS)!;
  const id = created[2];
  expect(records.get(id).candidateName).toBe('Test Client');
  expect(records.get(id).progressStatus).toBe('New');
  records.set(id, { ...records.get(id), marketingTl: 'Marketing TL', recruiterName: 'Recruiter', progressStatus: 'In Progress', notes: 'Keep', finalFeedback: 'Keep final', finalSavedAt: 'saved' });
  await syncClientProgress(db as unknown as Databases, null, lead);
  expect(db.createDocument.mock.calls.filter(([, collection]) => collection === COLLECTIONS.CLIENT_PROGRESS)).toHaveLength(1);
  expect(records.get(id)).toMatchObject({ marketingTl: 'Marketing TL', recruiterName: 'Recruiter', progressStatus: 'In Progress', notes: 'Keep', finalFeedback: 'Keep final' });
  await syncClientProgress(db as unknown as Databases, lead, { ...lead, status: 'Backed Out' });
  expect(records.get(id).eligible).toBe(false);
  await syncClientProgress(db as unknown as Databases, { ...lead, status: 'Backed Out' }, lead);
  expect(records.get(id)).toMatchObject({ eligible: true, finalFeedback: 'Keep final' });
});

test('handles deleted legacy salespeople without dropping eligible clients', async () => {
  const { db, records } = database(); records.delete('salesperson');
  await syncClientProgress(db as unknown as Databases, null, lead);
  const created = db.createDocument.mock.calls.find(([, collection]) => collection === COLLECTIONS.CLIENT_PROGRESS)!;
  expect(records.get(created[2])).toMatchObject({ salespersonName: 'Former Sales user', candidateName: 'Test Client' });
});

test('source synchronization cannot resurrect a manually excluded progress status', async () => {
  const { db, records } = database(); await syncClientProgress(db as unknown as Databases, null, lead);
  const id = db.createDocument.mock.calls.find(([, collection]) => collection === COLLECTIONS.CLIENT_PROGRESS)![2];
  records.set(id, { ...records.get(id), progressStatus: 'Not Interested' });
  await syncClientProgress(db as unknown as Databases, null, lead);
  expect(records.get(id).progressStatus).toBe('Not Interested');
});
