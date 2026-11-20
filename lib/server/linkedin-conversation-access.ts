import { isRoleEligibleForComponent } from '@/lib/constants/component-access';
import type { createAdminClient } from '@/lib/server/appwrite';
import type { LinkedinRequest, User } from '@/lib/types';

type Databases = Awaited<ReturnType<typeof createAdminClient>>['databases'];

export function canJoinLinkedinConversations(user: Pick<User, 'department' | 'isActive' | 'role'>) {
  return user.isActive !== false && (user.department ?? 'sales') === 'sales' &&
    isRoleEligibleForComponent('linkedin-conversations', user.role);
}

export async function hasLinkedinConversationAccess(_databases: Databases, actor: User) {
  return canJoinLinkedinConversations(actor);
}

export function canReadAllLinkedinConversations(actor: Pick<User, 'role'>) {
  return ['admin', 'developer', 'monitor', 'operations'].includes(actor.role);
}

export function canReadLinkedinConversation(actor: User, request: Pick<LinkedinRequest, 'agentId' | 'teamLeadId'>) {
  return canJoinLinkedinConversations(actor) && (request.agentId === actor.$id || canReadAllLinkedinConversations(actor) ||
    (actor.role === 'team_lead' && request.teamLeadId === actor.$id));
}
