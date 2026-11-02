/** @jest-environment node */
import { publishClientCardAction, revokeClientCardAction, getClientCardShareStatusAction } from '@/lib/services/client-progress-service';
import { getAuthenticatedUserDoc } from '@/lib/server/current-user';
import { createAdminClient } from '@/lib/server/appwrite';
import { COLLECTIONS } from '@/lib/constants/appwrite';
import { matchesCardToken } from '@/lib/server/client-card-security';
jest.mock('@/lib/server/current-user', () => ({ getAuthenticatedUserDoc: jest.fn() }));
jest.mock('@/lib/server/appwrite', () => ({ createAdminClient: jest.fn() }));
jest.mock('@/lib/services/audit-service', () => ({ logAction: jest.fn() }));
jest.mock('@/lib/server/appwrite-errors', () => ({ getAppwriteErrorMessage: jest.fn() }));
const entry = { $id: 'entry', $updatedAt: 'v1', eligible: true, leadId: '', candidateName: 'Client', salespersonId: 'agent', salespersonName: 'Agent',
  email: '', phone: '', department: 'sales', progressStatus: 'New', enteredAt: '2026-11-01T12:00:00Z' };
let shares: Map<string, any>; let events: Map<string, any>;
const db = {
  getDocument: jest.fn(async (_d, collection, id) => {
    if (collection === COLLECTIONS.CLIENT_PROGRESS) return entry;
    const value = (collection === COLLECTIONS.CLIENT_PROGRESS_SHARES ? shares : events).get(id);
    if (!value) throw { code: 404 }; return value;
  }),
  createDocument: jest.fn(async (_d, collection, id, data, permissions) => {
    const map = collection === COLLECTIONS.CLIENT_PROGRESS_SHARES ? shares : events;
    if (map.has(id)) throw { code: 409 };
    const row = { $id: id, ...data }; map.set(id, row); expect(permissions).toEqual([]); return row;
  }),
  updateDocument: jest.fn(async (_d, collection, id, data, permissions) => {
    const map = collection === COLLECTIONS.CLIENT_PROGRESS_SHARES ? shares : events;
    if (!map.has(id)) throw { code: 404 };
    const row = { ...map.get(id), ...data }; map.set(id, row); expect(permissions).toEqual([]); return row;
  }),
  deleteDocument: jest.fn(async (_d, _c, id) => { events.delete(id); }), listDocuments: jest.fn(),
};
beforeEach(() => {
  jest.clearAllMocks(); shares = new Map(); events = new Map();
  (getAuthenticatedUserDoc as jest.Mock).mockResolvedValue({ $id: 'admin', role: 'admin', name: 'Admin', isActive: true, department: 'sales' });
  (createAdminClient as jest.Mock).mockResolvedValue({ databases: { ...db, uncachedReads: db } });
});
test.each(['developer', 'monitor', 'operations', 'senior_tl', 'team_lead', 'agent', 'lead_generation', 'compliance'])('%s cannot publish, revoke or manage links before any database work', async role => {
  (getAuthenticatedUserDoc as jest.Mock).mockResolvedValue({ $id: 'user', role, isActive: true });
  await expect(publishClientCardAction({ id: 'entry', days: 7, includeContact: false, includeNotes: true })).rejects.toThrow('Only Admin');
  await expect(revokeClientCardAction('entry')).rejects.toThrow('Only Admin');
  await expect(getClientCardShareStatusAction('entry')).rejects.toThrow('Only Admin');
  expect(createAdminClient).not.toHaveBeenCalled();
});
test('publishing stores only a token hash, audits disclosure options, rotates old links and revokes future access', async () => {
  const first = await publishClientCardAction({ id: 'entry', days: 7, includeContact: false, includeNotes: true });
  const firstToken = first.path.split('#')[1];
  const firstGrant = [...shares.values()][0];
  expect(first.path).toMatch(/^\/share\/client#s_/);
  expect(firstGrant).toMatchObject({ entryId: 'entry', issuerId: 'admin', includeContact: false, includeNotes: true, revoked: false });
  expect(matchesCardToken(firstToken, firstGrant.tokenHash)).toBe(true);
  expect(JSON.stringify([...shares.values(), ...events.values()])).not.toContain(firstToken);
  expect(db.listDocuments).not.toHaveBeenCalled(); // No copying or scanning the feedback archive.
  const second = await publishClientCardAction({ id: 'entry', days: 1, includeContact: true, includeNotes: false });
  expect(shares.size).toBe(1);
  const current = [...shares.values()][0];
  expect(matchesCardToken(firstToken, current.tokenHash)).toBe(false);
  expect(matchesCardToken(second.path.split('#')[1], current.tokenHash)).toBe(true);
  await revokeClientCardAction('entry'); expect([...shares.values()][0].revoked).toBe(true);
  expect([...events.values()].every(event => event.kind === 'audit')).toBe(true);
});
test('forged options and unbounded expiration are rejected without database writes', async () => {
  await expect(publishClientCardAction({ id: 'entry', days: 365, includeContact: true, includeNotes: true })).rejects.toThrow();
  await expect(publishClientCardAction({ id: 'entry', days: 7, includeContact: false, includeNotes: true, issuerId: 'someone-else' })).rejects.toThrow();
  expect(db.createDocument).not.toHaveBeenCalled(); expect(db.updateDocument).not.toHaveBeenCalled();
});
