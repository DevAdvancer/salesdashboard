'use server';

import { createAdminClient } from '@/lib/server/appwrite';
import { BUCKETS, COLLECTIONS, DATABASE_ID } from '@/lib/constants/appwrite';
import { Permission, Role, ID, Query } from 'node-appwrite';
import { Lead, User } from '@/lib/types';

type AdminDatabases = Awaited<ReturnType<typeof createAdminClient>>['databases'];
type HierarchyUserDocument = {
    $id: string;
    teamLeadId?: string | null;
};

export async function getHierarchyPermissionsServer(userId: string, databases: AdminDatabases): Promise<string[]> {
    const permissions: string[] = [];
    try {
        const visited = new Set<string>([userId]);
        let currentId: string | null = userId;

        for (let depth = 0; depth < 5 && currentId; depth++) {
            try {
                const user = (await databases.getDocument(
                    DATABASE_ID,
                    COLLECTIONS.USERS,
                    currentId
                )) as unknown as User;

                const supervisors = new Set<string>();
                if (user.teamLeadId) supervisors.add(user.teamLeadId);

                for (const supId of supervisors) {
                    if (!visited.has(supId)) {
                        permissions.push(Permission.read(Role.user(supId)));
                        permissions.push(Permission.update(Role.user(supId)));
                        permissions.push(Permission.delete(Role.user(supId)));
                        visited.add(supId);
                    }
                }

                if (user.teamLeadId && !visited.has(user.teamLeadId)) {
                    currentId = user.teamLeadId;
                } else {
                    currentId = null;
                }
            } catch (err) {
                console.error(`Error fetching user ${currentId} for hierarchy:`, err);
                break;
            }
        }
    } catch (e) {
        console.error(`Error fetching hierarchy permissions for user ${userId}:`, e);
    }
    return permissions;
}

export function getUserBranchIds(user: User): string[] {
    const branchIds = Array.isArray(user.branchIds) ? user.branchIds : [];
    return user.branchId && !branchIds.includes(user.branchId)
        ? [...branchIds, user.branchId]
        : branchIds;
}

export function hasBranchOverlap(left: User, right: User): boolean {
    const leftBranchIds = new Set(getUserBranchIds(left));
    return getUserBranchIds(right).some((branchId) => leftBranchIds.has(branchId));
}

export function getVisibleHierarchyUserIds(viewerId: string, users: HierarchyUserDocument[]): string[] {
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

export async function getVisibleUserIdsForActor(actor: User, databases: AdminDatabases): Promise<string[]> {
    if (actor.role === 'admin' || actor.role === 'developer') return [];

    if (actor.role === 'team_lead') {
        const subordinates = await databases.listDocuments(
            DATABASE_ID,
            COLLECTIONS.USERS,
            [
                Query.equal('teamLeadId', actor.$id),
                Query.or([Query.equal('role', 'agent'), Query.equal('role', 'lead_generation')]),
                Query.limit(5000),
            ]
        );

        return [actor.$id, ...subordinates.documents.map((doc) => String(doc.$id))];
    }

    const users = await databases.listDocuments(
        DATABASE_ID,
        COLLECTIONS.USERS,
        [Query.limit(5000)]
    );

    return getVisibleHierarchyUserIds(actor.$id, users.documents as unknown as HierarchyUserDocument[]);
}

export async function assertAssignmentAllowed(actor: User, agent: User, lead: Lead, databases: AdminDatabases) {
    if (actor.role === 'operations') {
        throw new Error('Permission denied');
    }

    if (actor.role === 'admin' || actor.role === 'developer') {
        return;
    }

    const actorOwnsLead = lead.ownerId === actor.$id;

    if (actor.role === 'lead_generation') {
        if (!actorOwnsLead) {
            throw new Error('Permission denied');
        }
        if (agent.role !== 'team_lead') {
            throw new Error('Lead generation can only assign leads to team leads.');
        }
        if (agent.isActive === false) {
            throw new Error('Inactive team leads cannot be assigned leads.');
        }
        return;
    }

    if (agent.role !== 'agent') {
        throw new Error('Leads can only be assigned to agents.');
    }

    if (actorOwnsLead) {
        if (agent.isActive === false) {
            throw new Error('Inactive agents cannot be assigned leads.');
        }
        return;
    }

    if (actor.role === 'team_lead') {
        if (agent.teamLeadId !== actor.$id) {
            throw new Error('Team leads can only assign agents under them.');
        }
    }

    const visibleUserIds = await getVisibleUserIdsForActor(actor, databases);
    const leadInScope =
        visibleUserIds.includes(lead.ownerId) ||
        (lead.assignedToId ? visibleUserIds.includes(lead.assignedToId) : false) ||
        Boolean(lead.branchId && getUserBranchIds(actor).includes(lead.branchId));

    if (!leadInScope) {
        throw new Error('Permission denied');
    }
}

export async function assertLeadAccessAllowed(actor: User, lead: Lead, databases: AdminDatabases) {
    if (actor.role === 'operations') {
        throw new Error('Permission denied');
    }

    if (actor.role === 'monitor') {
        if (lead.ownerId === actor.$id) {
            return;
        }
        throw new Error('Permission denied');
    }

    if (actor.role === 'admin' || actor.role === 'developer') {
        return;
    }

    const visibleUserIds = await getVisibleUserIdsForActor(actor, databases);
    const leadInScope =
        visibleUserIds.includes(lead.ownerId) ||
        (lead.assignedToId ? visibleUserIds.includes(lead.assignedToId) : false) ||
        Boolean(lead.branchId && getUserBranchIds(actor).includes(lead.branchId));

    if (!leadInScope) {
        throw new Error('Permission denied');
    }
}
