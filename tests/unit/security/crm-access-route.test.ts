/** @jest-environment node */
import { GET, POST } from '@/app/api/security/access/route';
import { NextRequest } from 'next/server';
import { evaluateCrmAccess, resolveSecurityIdentity } from '@/lib/server/crm-access';
jest.mock('@/lib/server/crm-access', () => ({ crmAccessEnabled: () => true, resolveSecurityIdentity: jest.fn(), evaluateCrmAccess: jest.fn(),
  CrmAccessError: class extends Error { constructor(public status: number, message: string) { super(message); } } }));
jest.mock('@/lib/server/crm-browser-data', () => ({ publicUser: (user: unknown) => user }));
jest.mock('@/lib/server/maintenance', () => ({ getRequestMaintenanceStatus: async () => ({ active: false }), isMaintenanceManager: () => false }));
const identity = { user: { $id: 'person', name: 'Person', role: 'agent' }, account: { $id: 'person' }, session: { $id: 'session' } };
beforeEach(() => { jest.clearAllMocks(); (resolveSecurityIdentity as jest.Mock).mockResolvedValue(identity);
  (evaluateCrmAccess as jest.Mock).mockResolvedValue({ state: 'allowed', dateKey: '2026-10-28' }); });
it('returns a safe own-profile bootstrap with a fresh native session decision', async () => {
  const response = await GET(new NextRequest('http://localhost:5000/api/security/access?view=bootstrap'));
  expect(await response.json()).toMatchObject({ user: { $id: 'person' }, status: { state: 'allowed' } });
  expect(resolveSecurityIdentity).toHaveBeenCalledTimes(1);
  expect(evaluateCrmAccess).toHaveBeenCalledWith(identity);
});
it('retires the approvals endpoint without querying historical requests', async () => {
  expect((await GET(new NextRequest('http://localhost:5000/api/security/access?view=approvals'))).status).toBe(410);
  expect(resolveSecurityIdentity).not.toHaveBeenCalled();
});
it('retires all custom code and cover POST operations without performing writes', async () => {
  expect((await POST()).status).toBe(410);
  expect(resolveSecurityIdentity).not.toHaveBeenCalled();
  expect(evaluateCrmAccess).not.toHaveBeenCalled();
});
