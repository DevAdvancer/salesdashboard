import { isRoleEligibleForComponent } from '@/lib/constants/component-access';
import { hasBetaFeatureAccess, LINKEDIN_CONVERSATIONS_FEATURE } from '@/lib/server/beta-feature-access';
import type { createAdminClient } from '@/lib/server/appwrite';
import type { LinkedinRequest, User } from '@/lib/types';

type Databases = Awaited<ReturnType<typeof createAdminClient>>['databases'];

export function canJoinLinkedinConversations(user: Pick<User, 'department' | 'isActive' | 'role'>) {
  return user.isActive !== false && (user.department ?? 'sales') === 'sales' &&
    isRoleEligibleForComponent('linkedin-conversations', user.role);
}

export function hasLinkedinConversationAccess(databases: Databases, actor: User) {
  return canJoinLinkedinConversations(actor) && hasBetaFeatureAccess(databases, actor.$id, LINKEDIN_CONVERSATIONS_FEATURE);
}

export function canReadLinkedinConversation(actor: User, request: Pick<LinkedinRequest, 'agentId' | 'teamLeadId'>) {
  return canJoinLinkedinConversations(actor) && (request.agentId === actor.$id || actor.role === 'admin' ||
    (actor.role === 'team_lead' && request.teamLeadId === actor.$id));
}
