/** @jest-environment node */
import { GET, POST } from '@/app/api/security/access/route';
import { NextRequest } from 'next/server';
import { assertCrmAccess, evaluateCrmAccess, listAccessApprovals, resolveSecurityIdentity } from '@/lib/server/crm-access';
import { consumeEmailOtp } from '@/lib/server/crm-security-store';
const mockSetCookie = jest.fn();
jest.mock('next/headers', () => ({ cookies: async () => ({ set: mockSetCookie }) }));
jest.mock('@/lib/server/crm-access', () => ({ crmAccessEnabled: () => true, resolveSecurityIdentity: jest.fn(), assertCrmAccess: jest.fn(),
  evaluateCrmAccess: jest.fn(), effectiveCrmAuditActor: async (actor: unknown) => actor, listAccessApprovals: jest.fn(), securityDatabase: () => ({}),
  CrmAccessError: class extends Error { constructor(public status: number, message: string) { super(message); } } }));
jest.mock('@/lib/server/crm-security-store', () => ({ consumeEmailOtp: jest.fn(), signProof: () => 'signed-proof', CRM_PROOF_COOKIE: 'proof-cookie', PROOF_TTL_MS: 3600_000 }));
jest.mock('@/lib/server/crm-browser-data', () => ({ publicUser: (user: unknown) => user }));
jest.mock('@/lib/server/maintenance', () => ({ getRequestMaintenanceStatus: async () => ({ active: false }), isMaintenanceManager: () => false }));
const identity = { user: { $id: 'person', name: 'Person', role: 'agent' }, account: { $id: 'person' }, session: { $id: 'session', expire: '2030-01-01T00:00:00Z' } };
beforeEach(() => {
  jest.clearAllMocks();
  (resolveSecurityIdentity as jest.Mock).mockResolvedValue(identity);
  (evaluateCrmAccess as jest.Mock).mockResolvedValue({ state: 'allowed', dateKey: '2026-10-22' });
  (listAccessApprovals as jest.Mock).mockResolvedValue([]);
});
it('returns the verified access decision with the OTP response', async () => {
  const response = await POST(new NextRequest('http://localhost:5000/api/security/access', { method: 'POST',
    headers: { origin: 'http://localhost:5000', 'content-type': 'application/json' }, body: JSON.stringify({ operation: 'verify-login', challengeId: 'challenge', code: '123456' }) }));
  expect(await response.json()).toMatchObject({ success: true, status: { state: 'allowed' } });
  expect(consumeEmailOtp).toHaveBeenCalledTimes(1); expect(mockSetCookie).toHaveBeenCalledTimes(1);
  expect(evaluateCrmAccess).toHaveBeenCalledWith({ ...identity, proof: 'signed-proof' });
});
it('returns an own-profile/bootstrap status from one fresh identity read', async () => {
  const response = await GET(new NextRequest('http://localhost:5000/api/security/access?view=bootstrap'));
  expect(await response.json()).toMatchObject({ user: { $id: 'person' }, status: { state: 'allowed' } });
  expect(resolveSecurityIdentity).toHaveBeenCalledTimes(1);
});
it('loads delegate approvals without a full attendance roster and reuses the authenticated identity', async () => {
  const response = await GET(new NextRequest('http://localhost:5000/api/security/access?view=approvals'));
  expect(await response.json()).toEqual({ requests: [] });
  expect(assertCrmAccess).toHaveBeenCalledWith(undefined, identity);
  expect(resolveSecurityIdentity).toHaveBeenCalledTimes(1);
});
it('rejects the removed mark-present operation at the server boundary', async () => {
  const response = await POST(new NextRequest('http://localhost:5000/api/security/access', { method: 'POST',
    headers: { origin: 'http://localhost:5000', 'content-type': 'application/json' }, body: JSON.stringify({ operation: 'mark-present', userId: 'target' }) }));
  expect(response.status).toBe(400); expect(resolveSecurityIdentity).not.toHaveBeenCalled();
});
