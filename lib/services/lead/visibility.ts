import { Permission, Role, Query } from 'appwrite';
import { databases, DATABASE_ID, COLLECTIONS } from '@/lib/appwrite';
import { UserRole } from '@/lib/types';
import { getUserById } from '@/lib/services/user-service';
import { isValidId } from "../../../app/actions/lead/sync-helpers";

export type HierarchyUserDocument = {
  $id: string;
  teamLeadId?: string | null;
};

export function getVisibleHierarchyUserIds(viewerId: string, viewerRole: UserRole, users: HierarchyUserDocument[]): string[] {
  if (viewerRole === 'agent') return [viewerId];

  const visibleIds = new Set<string>([viewerId]);
  let changed = true;

  while (changed) {
    changed = false;
    users.forEach((candidate) => {
      if (visibleIds.has(candidate.$id)) return;

      const reportsToVisibleTeamLead = Boolean(candidate.teamLeadId && visibleIds.has(candidate.teamLeadId));

      if (reportsToVisibleTeamLead) {
        visibleIds.add(candidate.$id);
        changed = true;
      }
    });
  }

  return Array.from(visibleIds);
}

export async function getLeadVisibilityUserIds(viewerId: string, viewerRole: UserRole): Promise<string[]> {
  if (viewerRole === 'agent') return [viewerId];

  if (viewerRole === 'team_lead') {
    const agents = await databases.listDocuments(
      DATABASE_ID,
      COLLECTIONS.USERS,
      [
        Query.equal('teamLeadId', viewerId),
        Query.or([Query.equal('role', 'agent'), Query.equal('role', 'lead_generation')]),
      ]
    );

    return [viewerId, ...agents.documents.map((agent) => agent.$id)];
  }

  const response = await databases.listDocuments(
    DATABASE_ID,
    COLLECTIONS.USERS,
    [Query.limit(5000)]
  );

  return getVisibleHierarchyUserIds(viewerId, viewerRole, response.documents as unknown as HierarchyUserDocument[]);
}

export type TeamLeadScopedUserDocument = {
  $id: string;
  role?: UserRole;
};

export async function getTeamLeadLeadVisibilityScope(viewerId: string): Promise<{
  ownerVisibleUserIds: string[];
  assignmentVisibleUserIds: string[];
}> {
  const teamUsers = await databases.listDocuments(
    DATABASE_ID,
    COLLECTIONS.USERS,
    [
      Query.equal('teamLeadId', viewerId),
      Query.or([Query.equal('role', 'agent'), Query.equal('role', 'lead_generation')]),
    ]
  );

  const docs = teamUsers.documents as unknown as TeamLeadScopedUserDocument[];
  const assignmentVisibleUserIds = [viewerId, ...docs.map((user) => user.$id)];
  const ownerVisibleUserIds = [
    viewerId,
    ...docs
      .filter((user) => user.role === 'agent')
      .map((user) => user.$id),
  ];

  return { ownerVisibleUserIds, assignmentVisibleUserIds };
}

export function appendHierarchyLeadVisibilityQuery(
  queries: string[],
  visibleUserIds: string[],
  branchIds?: string[],
  includeBackedOutForBranches?: boolean
) {
  const orConditions = [
    Query.equal('ownerId', visibleUserIds),
    Query.equal('assignedToId', visibleUserIds),
  ];

  if (includeBackedOutForBranches && branchIds && branchIds.length > 0) {
    orConditions.push(
      Query.and([
        Query.equal('branchId', branchIds[0]),
        Query.equal('isClosed', true),
        Query.equal('status', ['Backout', 'Backed Out', 'Backedout', 'Backed out']),
      ])
    );
  }

  queries.push(Query.or(orConditions));
}

export function appendTeamLeadLeadVisibilityQuery(
  queries: string[],
  ownerVisibleUserIds: string[],
  assignmentVisibleUserIds: string[],
  branchIds?: string[],
  includeBackedOutForBranches?: boolean
) {
  const orConditions = [
    Query.equal('ownerId', ownerVisibleUserIds),
    Query.equal('assignedToId', assignmentVisibleUserIds),
  ];

  if (includeBackedOutForBranches && branchIds && branchIds.length > 0) {
    orConditions.push(
      Query.and([
        Query.equal('branchId', branchIds[0]),
        Query.equal('isClosed', true),
        Query.equal('status', ['Backout', 'Backed Out', 'Backedout', 'Backed out']),
      ])
    );
  }

  queries.push(Query.or(orConditions));
}

export function normalizeDepartment(value: unknown): 'sales' | 'resume' {
  return value === 'resume' ? 'resume' : 'sales';
}

export function leadMatchesDepartmentScope(
  lead: { ownerId: string; assignedToId?: string | null },
  visibleUserIds: Set<string>
) {
  return (
    visibleUserIds.has(lead.ownerId) ||
    (typeof lead.assignedToId === 'string' && visibleUserIds.has(lead.assignedToId))
  );
}

export function isMonitorRole(role: UserRole) {
  return role === 'monitor';
}

export function isOperationsRole(role: UserRole) {
  return role === 'operations';
}

export function isAdminLikeReadAllRole(role: UserRole) {
  return role === 'admin' || role === 'developer' || role === 'monitor' || role === 'operations';
}

export async function getHierarchyPermissions(userId: string): Promise<string[]> {
    const permissions: string[] = [];
    try {
        if (!isValidId(userId)) return permissions;

        const visited = new Set<string>([userId]);
        let currentId: string | null = userId;

        for (let depth = 0; depth < 5 && currentId && isValidId(currentId); depth++) {
            try {
                const user = await getUserById(currentId);

                const supervisors = new Set<string>();
                if (user.teamLeadId) supervisors.add(user.teamLeadId);

                for (const supId of supervisors) {
                    if (!visited.has(supId) && isValidId(supId)) {
                        permissions.push(Permission.read(Role.user(supId)));
                        permissions.push(Permission.update(Role.user(supId)));
                        permissions.push(Permission.delete(Role.user(supId)));
                        visited.add(supId);
                    } else if (supId && !isValidId(supId)) {
                        console.warn(`[getHierarchyPermissions] Skipped invalid supervisor ID: "${supId}"`);
                    }
                }

                if (user.teamLeadId && isValidId(user.teamLeadId) && !visited.has(user.teamLeadId)) {
                    currentId = user.teamLeadId;
                } else {
                    currentId = null;
                }
            } catch (inner) {
                console.warn(`[getHierarchyPermissions] Stopping at depth ${depth} due to:`, inner);
                break;
            }
        }
    } catch (e) {
        console.error(`Error fetching hierarchy permissions for user ${userId}:`, e);
    }
    return permissions;
}
