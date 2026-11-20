jest.mock('@/lib/server/beta-feature-access', () => ({
  hasBetaFeatureAccess: jest.fn(), LINKEDIN_CONVERSATIONS_FEATURE: 'linkedin-conversations',
}));

import fc from 'fast-check';
import { hasBetaFeatureAccess } from '@/lib/server/beta-feature-access';
import { canReadLinkedinConversation, hasLinkedinConversationAccess } from '@/lib/server/linkedin-conversation-access';
import { VALID_ROLES, type User } from '@/lib/types';
import { LINKEDIN_CONVERSATION_RELEASE_AT } from '@/lib/utils/linkedin-conversation-release';

it('opens at the release instant while retaining role, department, activation and request scope checks', async () => {
  const database = {} as Parameters<typeof hasLinkedinConversationAccess>[0];
  await fc.assert(fc.asyncProperty(fc.constantFrom(...VALID_ROLES), fc.constantFrom('sales', 'resume'),
    fc.boolean(), fc.boolean(), fc.boolean(), fc.boolean(), fc.constantFrom(-1, 0, 1, 86_400_000),
    async (role, department, isActive, granted, own, onTeam, offset) => {
      const actor = { $id: 'viewer', role, department, isActive } as User;
      const request = { agentId: own ? 'viewer' : 'sender', teamLeadId: onTeam ? 'viewer' : 'other-tl' };
      const eligible = isActive && department === 'sales' && ['agent', 'team_lead', 'admin'].includes(role);
      const lookup = jest.mocked(hasBetaFeatureAccess);
      lookup.mockClear().mockResolvedValue(granted);
      const now = new Date(Date.parse(LINKEDIN_CONVERSATION_RELEASE_AT) + offset);
      expect(await hasLinkedinConversationAccess(database, actor, now)).toBe(eligible && (offset >= 0 || granted));
      if (eligible && offset < 0) expect(lookup).toHaveBeenCalledWith(database, 'viewer', 'linkedin-conversations');
      else expect(lookup).not.toHaveBeenCalled();
      expect(canReadLinkedinConversation(actor, request)).toBe(eligible && (own || role === 'admin' || (role === 'team_lead' && onTeam)));
    }), { numRuns: 400 });
});
