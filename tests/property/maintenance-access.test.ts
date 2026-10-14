import fc from 'fast-check';
jest.mock('@/lib/server/appwrite', () => ({ createAdminClient: jest.fn() }));
import { isMaintenanceManager, parseMaintenanceConfig } from '@/lib/server/maintenance';

test('only the named admin may manage maintenance across arbitrary emails and roles', () => {
  fc.assert(fc.property(fc.emailAddress(), fc.constantFrom('agent', 'admin', 'developer', 'monitor'),
    (email, role) => {
      expect(isMaintenanceManager({ $id: '698a5e64002675ad41f6', email, role })).toBe(
        email.trim().toLowerCase() === 'abhirupvizva@gmail.com' && role === 'admin');
    }));
});

test('maintenance expires at the configured instant', () => {
  const raw = JSON.stringify({ enabled: true, endsAt: '2026-10-14T19:00:00.000Z' });
  expect(parseMaintenanceConfig(raw, new Date('2026-10-14T18:59:59.999Z')).active).toBe(true);
  expect(parseMaintenanceConfig(raw, new Date('2026-10-14T19:00:00.000Z')).active).toBe(false);
});

test('another account cannot use the manager email to bypass maintenance', () => {
  expect(isMaintenanceManager({ $id: 'another-id', email: 'abhirupvizva@gmail.com', role: 'admin' })).toBe(false);
});
