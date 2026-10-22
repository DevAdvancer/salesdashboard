/** @jest-environment node */
import fc from 'fast-check';
import { Query } from 'node-appwrite';
import { COLLECTIONS } from '@/lib/constants/appwrite';
import { readBrowserDocument, mutateBrowserBranch, validateBrowserQueries } from '@/lib/server/crm-browser-data';
import { evaluateCrmAccess, resolveSecurityIdentity, securityDatabase } from '@/lib/server/crm-access';
import { createAdminClient } from '@/lib/server/appwrite';
import { mayAccessResume } from '@/lib/server/crm-resume-gateway';
import type { User } from '@/lib/types';
jest.mock('@/lib/server/crm-access', () => ({ crmAccessEnabled: () => true, evaluateCrmAccess: jest.fn(), resolveSecurityIdentity: jest.fn(), securityDatabase: jest.fn(),
  CrmAccessError: class extends Error { constructor(public status: number, message: string) { super(message); } } }));
jest.mock('@/lib/server/appwrite', () => ({ createAdminClient: jest.fn() }));
const actor = { $id: 'agent', role: 'agent', department: 'sales', isActive: true } as User;
let db: { getDocument: jest.Mock; listDocuments: jest.Mock };
beforeEach(() => {
  jest.clearAllMocks();
  (resolveSecurityIdentity as jest.Mock).mockResolvedValue({ user: actor });
  (evaluateCrmAccess as jest.Mock).mockResolvedValue({ state: 'allowed' });
  db = { getDocument: jest.fn().mockResolvedValue({ $id: 'other', department: 'resume' }), listDocuments: jest.fn().mockResolvedValue({ total: 0, documents: [] }) };
  (securityDatabase as jest.Mock).mockReturnValue(db);
});
it('accepts SDK sort, selection and pagination queries without weakening user projections', () => {
  fc.assert(fc.property(fc.constantFrom('$createdAt', '$updatedAt', 'name'), attribute => {
    const queries = [Query.orderDesc(attribute), Query.orderAsc(attribute), Query.select(['name', 'isActive']), Query.limit(100)];
    expect(validateBrowserQueries(queries, COLLECTIONS.BRANCHES)).toEqual(queries);
    expect(() => validateBrowserQueries([Query.select(['notificationEmails'])], COLLECTIONS.USERS)).toThrow('projection');
  }));
});
it('permits only the own-profile bootstrap read before OTP, never lists or branch writes', async () => {
  await fc.assert(fc.asyncProperty(fc.constantFrom('otp_required', 'attendance_required', 'approval_pending', 'approval_denied'), async state => {
    (evaluateCrmAccess as jest.Mock).mockResolvedValue({ state });
    await expect(readBrowserDocument(COLLECTIONS.USERS, actor.$id, [])).resolves.toMatchObject({ $id: actor.$id });
    await expect(readBrowserDocument(COLLECTIONS.USERS, null, [])).rejects.toThrow('verification');
    await expect(readBrowserDocument(COLLECTIONS.BRANCHES, null, [])).rejects.toThrow('verification');
    await expect(mutateBrowserBranch('POST', null, { data: { name: 'Branch' } })).rejects.toThrow('verification');
  }));
  expect(db.listDocuments).not.toHaveBeenCalled(); expect(createAdminClient).not.toHaveBeenCalled();
});
it('keeps ordinary users within their department and refuses generic lead/admin collection reads', async () => {
  await expect(readBrowserDocument(COLLECTIONS.USERS, 'other', [])).rejects.toThrow('another department');
  await expect(readBrowserDocument(COLLECTIONS.LEADS, null, [])).rejects.toThrow('scoped');
  await expect(readBrowserDocument(COLLECTIONS.CRM_ACCESS_REQUESTS, null, [])).rejects.toThrow('authorized');
  await readBrowserDocument(COLLECTIONS.USERS, null, []);
  expect(db.listDocuments.mock.calls[0][2]).toContain(Query.equal('department', 'sales'));
});
it('rejects arbitrary user projections, including wildcard and nested queries', () => {
  fc.assert(fc.property(fc.constantFrom('*', 'notificationEmails', 'password', 'preferences.*'), column => {
    expect(() => validateBrowserQueries([Query.select([column])])).toThrow('projection');
  }));
});
it('does not grant resume reads/deletes through public ACLs or another user ACL', () => {
  fc.assert(fc.property(fc.uuid(), fc.uuid(), (id, other) => {
    fc.pre(id !== other);
    const viewer = { ...actor, $id: id };
    const permissions = [`read("any")`, `delete("users")`, `read("user:${other}")`];
    expect(mayAccessResume(viewer, permissions)).toBe(false);
    expect(mayAccessResume(viewer, permissions, true)).toBe(false);
    expect(mayAccessResume(viewer, [`read("user:${id}")`])).toBe(true);
    expect(mayAccessResume({ ...viewer, role: 'monitor' }, [`delete("user:${id}")`], true)).toBe(false);
  }));
});
