import { withImpersonationAudit } from '@/lib/server/impersonation-audit';
import type { Databases } from 'node-appwrite';
const mockIdentity = jest.fn();
const mockAudit = jest.fn();
const mockCookies = jest.fn();
jest.mock('next/headers', () => ({ cookies: () => mockCookies() }));
jest.mock('@/lib/server/crm-access', () => ({ resolveSecurityIdentity: () => mockIdentity() }));
jest.mock('@/lib/server/lead-history', () => ({ appendLeadHistory: (...args: unknown[]) => mockAudit(...args) }));
beforeEach(() => { jest.clearAllMocks(); mockCookies.mockResolvedValue({ get: () => ({ value: 'target' }) });
  mockIdentity.mockResolvedValue({ operator: { user: { $id: 'operator', name: 'Operator' } }, user: { $id: 'target', name: 'Target' } }); });
test('audits privileged CRM writes with the operator and target without recording document bodies', async () => {
  const write = jest.fn().mockResolvedValue({ $id: 'record' });
  const db = withImpersonationAudit({ updateDocument: write } as unknown as Databases, {} as Databases);
  await db.updateDocument('db', 'users', 'record', { confidential: 'secret' });
  expect(mockAudit.mock.calls[0][1]).toMatchObject({ eventType: 'IMPERSONATION_MUTATION_ATTEMPT',
    actor: { id: 'operator', impersonatedUserId: 'target' }, payload: { collectionId: 'users', operation: 'updateDocument' } });
  expect(JSON.stringify(mockAudit.mock.calls)).not.toContain('secret');
  expect(mockAudit.mock.invocationCallOrder[0]).toBeLessThan(write.mock.invocationCallOrder[0]);
  expect(mockAudit.mock.calls[1][1].eventType).toBe('IMPERSONATION_MUTATION_COMPLETED');
});
test('rejects a write if the live impersonation check fails and leaves normal writes unchanged', async () => {
  const write = jest.fn().mockResolvedValue({});
  const db = withImpersonationAudit({ updateDocument: write } as unknown as Databases, {} as Databases);
  mockIdentity.mockRejectedValue(new Error('Revoked'));
  await expect(db.updateDocument('db', 'users', 'record', {})).rejects.toThrow('Revoked');
  expect(write).not.toHaveBeenCalled();
  mockCookies.mockResolvedValue({ get: () => undefined });
  await db.updateDocument('db', 'users', 'record', {});
  expect(write).toHaveBeenCalledTimes(1); expect(mockAudit).not.toHaveBeenCalled();
});
