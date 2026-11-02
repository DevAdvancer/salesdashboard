/** @jest-environment node */
import { readPublicClientCard } from '@/lib/server/public-client-card';
import { newCardToken, clientCardSubject, decodeCardCursor } from '@/lib/server/client-card-security';
import { createAdminClient } from '@/lib/server/appwrite';
import { COLLECTIONS } from '@/lib/constants/appwrite';
jest.mock('@/lib/server/appwrite', () => ({ createAdminClient: jest.fn() }));
let entry: any, issuer: any, share: any, token: string, lead: any;
const oldKey = process.env.APPWRITE_API_KEY;
const db = { getDocument: jest.fn(), listDocuments: jest.fn(), createDocument: jest.fn(), updateDocument: jest.fn() };
beforeEach(() => {
  jest.clearAllMocks(); process.env.APPWRITE_API_KEY = 'test-only-cursor-key';
  entry = { $id: 'entry', candidateName: 'Test Client', email: 'private@example.com', phone: '555', leadId: '', salespersonId: 'agent', salespersonName: 'Agent',
    marketingTl: 'Marketing TL', recruiterName: 'Recruiter', progressStatus: 'Placed', eligible: true, enteredAt: '2026-09-01T12:00:00Z',
    marketingStartedOn: '2026-09-15', notes: 'Private remarks', finalFeedback: 'Final review', finalSavedAt: 'saved', privateSecret: 'DO NOT SHARE', department: 'sales' };
  issuer = { $id: 'admin', role: 'admin', isActive: true };
  const fresh = newCardToken('entry'); token = fresh.token;
  share = { $id: fresh.id, entryId: 'entry', tokenHash: fresh.tokenHash, subjectHash: clientCardSubject(entry, null), issuerId: 'admin',
    expiresAt: new Date(Date.now() + 86400000).toISOString(), revoked: false, includeContact: false, includeNotes: false };
  lead = null;
  db.getDocument.mockImplementation(async (_d, collection) => {
    if (collection === COLLECTIONS.CLIENT_PROGRESS_SHARES) return share;
    if (collection === COLLECTIONS.CLIENT_PROGRESS) return entry;
    if (collection === COLLECTIONS.USERS) return issuer;
    if (collection === COLLECTIONS.LEADS) return lead;
    throw new Error('Unexpected read');
  });
  db.listDocuments.mockResolvedValue({ documents: [{ $id: 'event', $createdAt: '2026-09-15T12:00:00Z', text: 'Feedback', authorName: 'Reviewer', authorId: 'PRIVATE USER ID', payload: 'PRIVATE AUDIT' }] });
  (createAdminClient as jest.Mock).mockResolvedValue({ databases: { ...db, uncachedReads: db } });
});
afterEach(() => { if (oldKey === undefined) delete process.env.APPWRITE_API_KEY; else process.env.APPWRITE_API_KEY = oldKey; });
test('public responses whitelist card and feedback fields; contacts/remarks require explicit inclusion', async () => {
  const result = await readPublicClientCard({ token });
  expect(result.card).toMatchObject({ candidateName: 'Test Client', marketingStartedOn: '2026-09-15', finalFeedback: 'Final review' });
  expect(result.card).not.toHaveProperty('email'); expect(result.card).not.toHaveProperty('notes');
  expect(result.feedback).toEqual([{ text: 'Feedback', authorName: 'Reviewer', createdAt: '2026-09-15T12:00:00Z' }]);
  expect(JSON.stringify(result)).not.toMatch(/DO NOT SHARE|PRIVATE|issuerId|tokenHash|subjectHash|salespersonId|entryId|leadId|\$id|department/);
  expect(db.createDocument).not.toHaveBeenCalled(); expect(db.updateDocument).not.toHaveBeenCalled();
  share.includeContact = true; share.includeNotes = true;
  expect((await readPublicClientCard({ token })).card).toMatchObject({ email: 'private@example.com', phone: '555', notes: 'Private remarks' });
});
test.each(['revoked', 'expired', 'wrong token'])('%s links stop before client or feedback reads', async mode => {
  if (mode === 'revoked') share.revoked = true;
  if (mode === 'expired') share.expiresAt = new Date(Date.now() - 1).toISOString();
  if (mode === 'wrong token') token = newCardToken('entry').token;
  await expect(readPublicClientCard({ token })).rejects.toThrow('unavailable');
  expect(db.getDocument).toHaveBeenCalledTimes(1); expect(db.listDocuments).not.toHaveBeenCalled();
});
test.each(['Backout', 'Backed Out', 'Not Interested'])('released status %s cannot be shared', async status => {
  entry.progressStatus = status;
  await expect(readPublicClientCard({ token })).rejects.toThrow('unavailable'); expect(db.listDocuments).not.toHaveBeenCalled();
});
test.each(['agent', 'developer', 'monitor', 'operations'])('issuer role changed to %s disables its links', async role => {
  issuer.role = role;
  await expect(readPublicClientCard({ token })).rejects.toThrow('unavailable'); expect(db.listDocuments).not.toHaveBeenCalled();
});
test('inactive issuer and reassigned/replaced clients disable previous links', async () => {
  issuer.isActive = false;
  await expect(readPublicClientCard({ token })).rejects.toThrow('unavailable');
  issuer.isActive = true; entry.salespersonId = 'other-agent';
  await expect(readPublicClientCard({ token })).rejects.toThrow('unavailable');
  expect(db.listDocuments).not.toHaveBeenCalled();
});
test('a linked lead is checked live; a backed-out source never exposes stale projected data', async () => {
  entry.leadId = 'lead'; lead = { $id: 'lead', isClosed: true, status: 'Not Interested', ownerId: 'agent', assignedToId: 'agent', closedAt: 'closed' };
  share.subjectHash = clientCardSubject(entry, lead);
  await expect(readPublicClientCard({ token })).rejects.toThrow('unavailable'); expect(db.listDocuments).not.toHaveBeenCalled();
});
test('feedback is capped at ten and its encrypted next cursor stays bound to this client', async () => {
  const rows = Array.from({ length: 10 }, (_, i) => ({ $id: `event-${i}`, $createdAt: 'date', text: `Feedback ${i}`, authorName: 'Name' }));
  db.listDocuments.mockResolvedValue({ documents: rows, total: 100000 });
  const result = await readPublicClientCard({ token });
  expect(result.feedback).toHaveLength(10); expect(decodeCardCursor(token, result.nextCursor!)).toBe('event-9');
  const queries = db.listDocuments.mock.calls[0][2].map((query: string) => JSON.parse(query));
  expect(queries).toEqual(expect.arrayContaining([expect.objectContaining({ method: 'limit', values: [10] }),
    expect.objectContaining({ method: 'equal', attribute: 'entryId', values: ['entry'] }), expect.objectContaining({ method: 'equal', attribute: 'kind', values: ['feedback'] })]));
  expect(db.getDocument).toHaveBeenCalledTimes(3); // share + client + issuer; no per-feedback reads.
});
