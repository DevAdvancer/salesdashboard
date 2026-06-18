'use client';

import { useState } from 'react';
import { User } from '@/lib/types';
import { User as UserIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

function getRoleWeight(role: User['role']) {
  switch (role) {
    case 'admin':
      return -1;
    case 'team_lead':
      return 2;
    case 'lead_generation':
      return 3;
    case 'agent':
      return 4;
    default:
      return 99;
  }
}

export function sortUsersForHierarchy(users: User[]) {
  return [...users].sort((a, b) => {
    const roleDiff = getRoleWeight(a.role) - getRoleWeight(b.role);
    if (roleDiff !== 0) return roleDiff;
    return a.name.localeCompare(b.name);
  });
}

export function hasExistingParent(target: User, allUsers: User[]) {
  if (target.role === 'team_lead') return false;
  if (target.role === 'agent' || target.role === 'lead_generation') {
    return Boolean(
      target.teamLeadId &&
        allUsers.some((u) => u.$id === target.teamLeadId),
    );
  }
  return false;
}

export function formatBranches(user: User, branchMap: Map<string, string>) {
  if (!user.branchIds?.length) return 'No branches';
  return user.branchIds
    .map((branchId) => branchMap.get(branchId) || branchId)
    .join(', ');
}

function BranchBadges({
  branchIds,
  branchMap,
}: {
  branchIds: string[];
  branchMap: Map<string, string>;
}) {
  if (!branchIds.length) {
    return (
      <span className="text-[11px] text-muted-foreground">No branches</span>
    );
  }

  return (
    <div className="mt-2 flex max-w-[360px] flex-wrap gap-1">
      {branchIds.map((branchId) => (
        <span
          key={branchId}
          className="rounded border border-border bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground"
          title={branchId}>
          {branchMap.get(branchId) || branchId}
        </span>
      ))}
    </div>
  );
}

export function TreeNode({
  user,
  allUsers,
  branchMap,
  level = 0,
}: {
  user: User;
  allUsers: User[];
  branchMap: Map<string, string>;
  level?: number;
}) {
  const [isExpanded, setIsExpanded] = useState(true);

  // Find children for this node
  const directReports = allUsers.filter((u) => {
    // Admin / monitor / operations see all team leads
    if (
      user.role === 'admin' ||
      user.role === 'developer' ||
      user.role === 'monitor' ||
      user.role === 'operations'
    ) {
      if (u.role === 'team_lead') return true;
    }
    // Team Lead sees assigned Agents
    if (user.role === 'team_lead') {
      return (
        u.teamLeadId === user.$id &&
        (u.role === 'agent' || u.role === 'lead_generation')
      );
    }
    return false;
  });

  // Sort children: Team Leads < Agents
  const sortedReports = sortUsersForHierarchy(directReports);

  const hasChildren = sortedReports.length > 0;

  return (
    <div className="relative pl-6">
      {/* Connector lines */}
      {level > 0 && <div className="absolute left-0 top-6 w-6 h-px bg-border" />}
      {/* Vertical line connecting to parent */}
      <div className="absolute left-0 top-0 h-full w-px bg-border" />

      <div className="py-2">
        <div
          className={cn(
            'flex items-center gap-3 p-3 rounded-lg border bg-card text-card-foreground shadow-sm transition-all w-fit min-w-[200px]',
            hasChildren && 'cursor-pointer hover:bg-accent/50',
          )}
          onClick={() => hasChildren && setIsExpanded(!isExpanded)}>
          <div
            className={cn(
              'p-2 rounded-full',
              user.role === 'team_lead' &&
                'bg-purple-100 text-purple-600 dark:bg-purple-900/20',
              user.role === 'lead_generation' &&
                'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/20',
              user.role === 'agent' &&
                'bg-green-100 text-green-600 dark:bg-green-600/20',
            )}>
            {user.role === 'team_lead' && <UserIcon className="h-4 w-4" />}
            {user.role === 'lead_generation' && (
              <UserIcon className="h-4 w-4" />
            )}
            {user.role === 'agent' && <UserIcon className="h-4 w-4" />}
          </div>

          <div>
            <p className="font-medium text-sm">{user.name}</p>
            <p className="text-xs text-muted-foreground capitalize">
              {user.role.replace('_', ' ')}
            </p>
            <BranchBadges
              branchIds={user.branchIds || []}
              branchMap={branchMap}
            />
          </div>
        </div>
      </div>

      {isExpanded && hasChildren && (
        <div className="relative border-l border-border ml-6 pl-6">
          {sortedReports.map((child) => (
            <TreeNode
              key={child.$id}
              user={child}
              allUsers={allUsers}
              branchMap={branchMap}
              level={level + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}
