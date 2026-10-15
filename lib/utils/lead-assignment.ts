import type { User } from '@/lib/types';

export function isSalesTeamLeadAssignee(user: Pick<User, 'role' | 'department' | 'isActive'>) {
  return user.role === 'team_lead' && (user.department ?? 'sales') === 'sales' && user.isActive !== false;
}
