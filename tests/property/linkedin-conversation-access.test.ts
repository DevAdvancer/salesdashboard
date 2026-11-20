jest.mock('@/lib/server/beta-feature-access', () => ({
  hasBetaFeatureAccess: jest.fn(), LINKEDIN_CONVERSATIONS_FEATURE: 'linkedin-conversations',
}));

import fc from 'fast-check';
import { hasBetaFeatureAccess } from '@/lib/server/beta-feature-access';
import { canReadLinkedinConversation, hasLinkedinConversationAccess } from '@/lib/server/linkedin-conversation-access';
import { VALID_ROLES, type User } from '@/lib/types';

it('grants access by role and scope without a per-user beta grant or release date', async () => {
  const database = {} as Parameters<typeof hasLinkedinConversationAccess>[0];
  await fc.assert(fc.asyncProperty(fc.constantFrom(...VALID_ROLES), fc.constantFrom('sales', 'resume'),
    fc.boolean(), fc.boolean(), fc.boolean(), fc.boolean(),
    async (role, department, isActive, granted, own, onTeam) => {
      const actor = { $id: 'viewer', role, department, isActive } as User;
      const request = { agentId: own ? 'viewer' : 'sender', teamLeadId: onTeam ? 'viewer' : 'other-tl' };
      const eligible = isActive && department === 'sales' && role !== 'compliance';
      const lookup = jest.mocked(hasBetaFeatureAccess);
      lookup.mockClear().mockResolvedValue(granted);
      expect(await hasLinkedinConversationAccess(database, actor)).toBe(eligible);
      expect(lookup).not.toHaveBeenCalled();
      const leadership = ['admin', 'developer', 'monitor', 'operations'].includes(role);
      expect(canReadLinkedinConversation(actor, request)).toBe(eligible && (own || leadership || (role === 'team_lead' && onTeam)));
    }), { numRuns: 400 });
});
