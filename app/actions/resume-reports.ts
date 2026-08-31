'use server';

import { createAdminClient } from "@/lib/server/appwrite";
import { getAuthenticatedUserDoc } from "@/lib/server/current-user";
import { COLLECTIONS, DATABASE_ID } from "@/lib/constants/appwrite";
import { Query } from "node-appwrite";
import { differenceInMinutes } from "date-fns";

export async function getResumeReportsAction(startDateIso: string, endDateIso: string) {
  const actor = await getAuthenticatedUserDoc();
  if (!actor || actor.department !== 'resume') {
    if (actor?.role !== 'admin' && actor?.role !== 'developer' && actor?.role !== 'operations' && actor?.role !== 'monitor') {
      throw new Error("Access denied");
    }
  }

  const { databases } = await createAdminClient();

  let assignedToIds: string[] | null = null;
  if (actor.role === 'agent') {
    assignedToIds = [actor.$id];
  } else if (actor.role === 'team_lead') {
    const allUsersRes = await databases.listDocuments(
      DATABASE_ID,
      COLLECTIONS.USERS,
      [Query.limit(1000)]
    );
    const teamIds = allUsersRes.documents
      .filter((u: any) => u.teamLeadId === actor.$id || u.$id === actor.$id)
      .map((u: any) => u.$id);
    assignedToIds = teamIds.length > 0 ? teamIds : [actor.$id];
  }

  const callsQueries: string[] = [
    Query.equal('status', 'call_done'),
    Query.greaterThanEqual('updatedAt', startDateIso),
    Query.lessThanEqual('updatedAt', endDateIso),
    Query.limit(1000)
  ];
  if (assignedToIds) {
    // If the list is large, we might need multiple queries, but typically teams are small.
    // However, Appwrite Query.equal takes an array of values!
    callsQueries.push(Query.equal('assignedToId', assignedToIds));
  }

  // Completed Calls (status === 'call_done') within the date range
  const completedCallsRes = await databases.listDocuments(
    DATABASE_ID,
    COLLECTIONS.CALL_REQUESTS,
    callsQueries
  );

  const profilesQueries: string[] = [
    Query.equal('movedToMarketing', true),
    Query.greaterThanEqual('marketingMovedAt', startDateIso),
    Query.lessThanEqual('marketingMovedAt', endDateIso),
    Query.limit(1000)
  ];
  if (assignedToIds) {
    profilesQueries.push(Query.equal('assignedToId', assignedToIds));
  }

  // Completed Profiles (movedToMarketing === true AND marketingMovedAt in range)
  const completedProfilesRes = await databases.listDocuments(
    DATABASE_ID,
    COLLECTIONS.RESUME_PROFILES,
    profilesQueries
  );

  let totalMinutes = 0;
  let countWithTiming = 0;

  // Group by agent name
  const agentStats = new Map<string, {
    completedCallsCount: number;
    completedProfilesCount: number;
    totalMinutes: number;
    countWithTiming: number;
  }>();

  completedCallsRes.documents.forEach((doc: any) => {
    const name = doc.assignedToName || 'Unassigned';
    if (!agentStats.has(name)) {
      agentStats.set(name, { completedCallsCount: 0, completedProfilesCount: 0, totalMinutes: 0, countWithTiming: 0 });
    }
    agentStats.get(name)!.completedCallsCount++;
  });

  completedProfilesRes.documents.forEach((doc: any) => {
    const name = doc.assignedToName || 'Unassigned';
    if (!agentStats.has(name)) {
      agentStats.set(name, { completedCallsCount: 0, completedProfilesCount: 0, totalMinutes: 0, countWithTiming: 0 });
    }
    
    const stats = agentStats.get(name)!;
    stats.completedProfilesCount++;

    if (doc.complianceApprovedAt && doc.marketingMovedAt) {
      const timingMinutes = differenceInMinutes(new Date(doc.marketingMovedAt), new Date(doc.complianceApprovedAt));
      if (timingMinutes >= 0) {
        stats.totalMinutes += timingMinutes;
        stats.countWithTiming++;
        totalMinutes += timingMinutes;
        countWithTiming++;
      }
    }
  });

  const agentReports = Array.from(agentStats.entries()).map(([assignedToName, stats]) => {
    const avgMinutes = stats.countWithTiming > 0 ? Math.floor(stats.totalMinutes / stats.countWithTiming) : 0;
    const avgHours = Math.floor(avgMinutes / 60);
    const avgMins = avgMinutes % 60;
    const avgTimingStr = stats.countWithTiming > 0 ? `${avgHours}h ${avgMins}m` : "N/A";

    return {
      assignedToName,
      completedCallsCount: stats.completedCallsCount,
      completedProfilesCount: stats.completedProfilesCount,
      avgTimingStr
    };
  });

  // Sort by completed profiles desc, then calls desc
  agentReports.sort((a, b) => {
    if (b.completedProfilesCount !== a.completedProfilesCount) return b.completedProfilesCount - a.completedProfilesCount;
    return b.completedCallsCount - a.completedCallsCount;
  });

  const avgMinutes = countWithTiming > 0 ? Math.floor(totalMinutes / countWithTiming) : 0;
  const avgHours = Math.floor(avgMinutes / 60);
  const avgMins = avgMinutes % 60;
  const avgTimingStr = countWithTiming > 0 ? `${avgHours}h ${avgMins}m` : "N/A";

  return {
    completedCallsCount: completedCallsRes.total,
    completedProfilesCount: completedProfilesRes.total,
    avgTimingStr,
    agentReports
  };
}
