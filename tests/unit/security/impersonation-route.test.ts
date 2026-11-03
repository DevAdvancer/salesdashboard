/** @jest-environment node */
import { NextRequest } from 'next/server';
import { GET, POST, DELETE } from '@/app/api/security/impersonation/route';
import { CRM_IMPERSONATION_COOKIE } from '@/lib/utils/crm-impersonation';
const mockOperator = jest.fn();
const mockIdentity = jest.fn();
const mockList = jest.fn();
const mockAudit = jest.fn();
jest.mock('node-appwrite', () => ({ Query: { equal: jest.fn(), limit: jest.fn(), select: jest.fn() } }));
jest.mock('@/lib/server/lead-history', () => ({ appendLeadHistory: (...args: unknown[]) => mockAudit(...args) }));
jest.mock('@/lib/server/crm-access', () => ({
  resolveImpersonationOperator: (...args: unknown[]) => mockOperator(...args),
  resolveSecurityIdentity: (...args: unknown[]) => mockIdentity(...args),
  securityDatabase: () => ({ listDocuments: (...args: unknown[]) => mockList(...args) }),
  CRM_ACCESS_COOKIE: 'crm_access', CrmAccessError: class extends Error { constructor(public status: number, message: string) { super(message); } },
}));
const request = (method: string, origin = 'http://localhost') => new NextRequest('http://localhost/api/security/impersonation', {
  method, headers: { origin, cookie: `${CRM_IMPERSONATION_COOKIE}=old-target` },
  ...(method === 'POST' ? { body: JSON.stringify({ target: 'target', role: 'admin', impersonator: true }) } : {}),
});
beforeEach(() => {
  jest.clearAllMocks();
  mockOperator.mockResolvedValue({ account: { impersonator: true }, user: { $id: 'operator', name: 'Operator' } });
  mockIdentity.mockResolvedValue({ user: { $id: 'target', name: 'Target', department: 'sales', role: 'agent' }, session: { expire: '2099-01-01T00:00:00Z' } });
});
test('native capability is required even if the body claims admin and impersonator privileges', async () => {
  mockOperator.mockResolvedValue({ account: { impersonator: false }, user: { $id: 'operator' } });
  expect((await POST(request('POST'))).status).toBe(403);
  expect(mockIdentity).not.toHaveBeenCalled(); expect(mockAudit).not.toHaveBeenCalled();
});
test('rejects cross-origin mutations before reading an identity', async () => {
  expect((await POST(request('POST', 'http://attacker.test'))).status).toBe(403);
  expect((await DELETE(request('DELETE', 'http://attacker.test'))).status).toBe(403);
  expect(mockOperator).not.toHaveBeenCalled();
});
test('validates native impersonation, audits both identities, then sets a protected target selector', async () => {
  const response = await POST(request('POST'));
  expect(response.status).toBe(200);
  expect(mockIdentity.mock.calls[0][0].get(CRM_IMPERSONATION_COOKIE)).toEqual({ value: 'target' });
  expect(response.cookies.get(CRM_IMPERSONATION_COOKIE)).toMatchObject({ value: 'target', httpOnly: true, sameSite: 'lax', path: '/' });
  expect(mockAudit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ eventType: 'IMPERSONATION_START', actor: expect.objectContaining({ id: 'operator', impersonatedUserId: 'target' }) }));
});
test('Stop clears the selector even after permission or session revocation', async () => {
  mockOperator.mockRejectedValue(new Error('Revoked'));
  const response = await DELETE(request('DELETE'));
  expect(response.status).toBe(200);
  expect(response.cookies.get(CRM_IMPERSONATION_COOKIE)?.value).toBe('');
});
test('status contains only UI identity information and is never cached', async () => {
  const response = await GET(request('GET'));
  expect(await response.json()).toEqual({ canImpersonate: true, operator: { id: 'operator', name: 'Operator' }, active: { id: 'target', name: 'Target' } });
  expect(response.headers.get('cache-control')).toBe('no-store');
});
