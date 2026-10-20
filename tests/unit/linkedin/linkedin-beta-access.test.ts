jest.mock('@/lib/server/current-user', () => ({ getAuthenticatedUserDoc: jest.fn() }));

import fc from 'fast-check';
import { getAuthenticatedUserDoc } from '@/lib/server/current-user';
import { getMyLinkedinHelperAccessAction, setLinkedinHelperBetaAccessAction } from '@/app/actions/beta';
import { canUseLinkedinExtension } from '@/lib/server/linkedin-extension-policy';
import { VALID_ROLES } from '@/lib/types';

it('releases access to every eligible user without a beta database record', async () => {
  await fc.assert(fc.asyncProperty(fc.constantFrom(...VALID_ROLES), fc.constantFrom('sales', 'resume'), fc.boolean(),
    async (role, department, isActive) => {
      const actor = { role, department: department as 'sales' | 'resume', isActive };
      (getAuthenticatedUserDoc as jest.Mock).mockResolvedValue(actor);
      expect(await getMyLinkedinHelperAccessAction()).toBe(canUseLinkedinExtension(actor));
    }));
});

it('prevents stale beta controls from revoking general-release access', async () => {
  (getAuthenticatedUserDoc as jest.Mock).mockResolvedValue({ role: 'admin', isActive: true });
  await expect(setLinkedinHelperBetaAccessAction('agent', false)).rejects.toThrow('retired');
  (getAuthenticatedUserDoc as jest.Mock).mockResolvedValue({ role: 'agent', isActive: true });
  await expect(setLinkedinHelperBetaAccessAction('agent', true)).rejects.toThrow('Only active admins');
});
