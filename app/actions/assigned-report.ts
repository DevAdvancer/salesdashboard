'use server';

import { createAdminClient } from "@/lib/server/appwrite";
import { Query } from "node-appwrite";
import { COLLECTIONS } from "@/lib/constants/appwrite";
import { assertAuthenticatedUserId } from "@/lib/server/current-user";
import { listAllDocuments } from "@/lib/server/appwrite-pagination";
import { expandIsoDateToStart, expandIsoDateToEnd } from "@/lib/utils/iso-date-range";
import type { UserRole } from "@/lib/types";

const DATABASE_ID = process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID!;

export interface MemberAssignmentSummary {
  userId: string;
  userName: string;
  role: string;
  totalLeads: number;
  byAdmin: number;
  byLeadGen: number;
  closedCount: number;
}

export interface TeamAssignmentSummary {
  teamLeadId: string;
  teamLeadName: string;
  totalLeads: number;
  byAdmin: number;
  byLeadGen: number;
  closedCount: number;
  members: MemberAssignmentSummary[];
}

function isLeadershipRole(ownerRole: string): boolean {
  return ['admin', 'developer', 'monitor', 'operations'].includes(ownerRole);
}

export async function getAssignedReportData(userId: string, dateFrom?: string, dateTo?: string): Promise<TeamAssignmentSummary[]> {
  await assertAuthenticatedUserId(userId);
  const { databases } = await createAdminClient();

  // Verify the user is leadership role
  const userDoc = await databases.getDocument(DATABASE_ID, COLLECTIONS.USERS, userId);
  const role = userDoc.role as UserRole;
  if (!['admin', 'developer', 'monitor', 'operations'].includes(role)) {
    throw new Error('Unauthorized');
  }

  // Load all relevant users
  const users = await listAllDocuments<{ $id: string; name: string; role: UserRole; teamLeadId: string | null; department?: string }>({
    databases,
    databaseId: DATABASE_ID,
    collectionId: COLLECTIONS.USERS,
    queries: [
      Query.equal('isActive', true),
      Query.or([
        Query.equal('department', 'sales'),
        Query.equal('role', ['admin', 'developer', 'monitor', 'operations'])
      ]),
      Query.select(['$id', 'name', 'role', 'teamLeadId', 'department'])
    ],
    pageLimit: 100,
    maxPages: 100,
  });

  const userMap = new Map<string, {name: string, role: UserRole, teamLeadId: string | null}>();
  const teamMap = new Map<string, string[]>();
  const teamLeadNames = new Map<string, string>();

  for (const user of users) {
    userMap.set(user.$id, { name: user.name, role: user.role, teamLeadId: user.teamLeadId });
    if (user.role === 'team_lead') {
      if (!teamMap.has(user.$id)) {
        teamMap.set(user.$id, []);
      }
      teamLeadNames.set(user.$id, user.name);
    }
  }

  for (const user of users) {
    if (user.role !== 'team_lead' && user.teamLeadId) {
      if (!teamMap.has(user.teamLeadId)) {
        teamMap.set(user.teamLeadId, []);
        teamLeadNames.set(user.teamLeadId, 'Unknown Team');
      }
      teamMap.get(user.teamLeadId)!.push(user.$id);
    }
  }

  // Initialize summary structures
  const summaries = new Map<string, TeamAssignmentSummary>();
  const memberSummaries = new Map<string, MemberAssignmentSummary>();

  for (const [teamLeadId, memberIds] of teamMap.entries()) {
    const tl = userMap.get(teamLeadId);
    if (!tl) continue;

    summaries.set(teamLeadId, {
      teamLeadId,
      teamLeadName: teamLeadNames.get(teamLeadId) || 'Unknown Team',
      totalLeads: 0,
      byAdmin: 0,
      byLeadGen: 0,
      closedCount: 0,
      members: []
    });

    const initMember = (id: string, name: string, r: string) => {
      if (r === 'lead_generation') return;
      memberSummaries.set(id, {
        userId: id,
        userName: name,
        role: r,
        totalLeads: 0,
        byAdmin: 0,
        byLeadGen: 0,
        closedCount: 0
      });
    };

    // Add team lead as a member of their own team
    initMember(teamLeadId, tl.name, tl.role);

    // Add other members
    for (const memberId of memberIds) {
      const m = userMap.get(memberId);
      if (m) {
        initMember(memberId, m.name, m.role);
      }
    }
  }

  // Load ALL leads
  const queries = [
    Query.select(['$id', 'ownerId', 'assignedToId', 'isClosed']),
    Query.orderDesc('$createdAt')
  ];
  
  if (dateFrom) {
    queries.push(Query.greaterThanEqual('$createdAt', expandIsoDateToStart(dateFrom)));
  }
  if (dateTo) {
    queries.push(Query.lessThanEqual('$createdAt', expandIsoDateToEnd(dateTo)));
  }

  const leads = await listAllDocuments<{ $id: string; ownerId: string; assignedToId: string | null; isClosed: boolean }>({
    databases,
    databaseId: DATABASE_ID,
    collectionId: process.env.NEXT_PUBLIC_APPWRITE_LEADS_COLLECTION_ID!,
    queries,
    pageLimit: 1000,
    maxPages: 500,
  });

  for (const lead of leads) {
    const assignedUser = lead.assignedToId || lead.ownerId;
    if (!assignedUser) continue;

    const assignedUserData = userMap.get(assignedUser);
    if (!assignedUserData) continue;

    const teamLeadId = assignedUserData.role === 'team_lead' ? assignedUser : assignedUserData.teamLeadId;
    if (!teamLeadId) continue;

    const ownerData = userMap.get(lead.ownerId);
    const ownerRole = ownerData ? ownerData.role : 'agent';
    
    const isByAdmin = isLeadershipRole(ownerRole);
    const isByLeadGen = ownerRole === 'lead_generation';

    // Only count leads assigned by Admin or Lead Gen
    if (!isByAdmin && !isByLeadGen) continue;

    const teamSummary = summaries.get(teamLeadId);
    const memberSummary = memberSummaries.get(assignedUser);

    // Removed teamSummary manual increments to prevent phantom leads

    if (memberSummary) {
      memberSummary.totalLeads++;
      if (isByAdmin) memberSummary.byAdmin++;
      if (isByLeadGen) memberSummary.byLeadGen++;
      if (lead.isClosed) memberSummary.closedCount++;
    }
  }

  // Assemble the final array
  const result: TeamAssignmentSummary[] = [];
  for (const [teamLeadId, summary] of summaries.entries()) {
    const memberIds = teamMap.get(teamLeadId) || [];
    
    // Add team lead's summary
    const tlSummary = memberSummaries.get(teamLeadId);
    if (tlSummary) {
      summary.members.push(tlSummary);
    }

    // Add members' summaries
    for (const memberId of memberIds) {
      const mSummary = memberSummaries.get(memberId);
      if (mSummary) {
        summary.members.push(mSummary);
      }
    }

    // Sort members by totalLeads descending
    summary.members.sort((a, b) => b.totalLeads - a.totalLeads);

    // Deriving team totals exactly from valid members to ensure UI matches the table perfectly
    summary.totalLeads = summary.members.reduce((sum, m) => sum + m.totalLeads, 0);
    summary.byAdmin = summary.members.reduce((sum, m) => sum + m.byAdmin, 0);
    summary.byLeadGen = summary.members.reduce((sum, m) => sum + m.byLeadGen, 0);
    summary.closedCount = summary.members.reduce((sum, m) => sum + m.closedCount, 0);

    result.push(summary);
  }

  // Sort teams by totalLeads descending
  result.sort((a, b) => b.totalLeads - a.totalLeads);

  return result;
}
