'use server';

import { createAdminClient } from '@/lib/server/appwrite';
import { COLLECTIONS, DATABASE_ID } from '@/lib/constants/appwrite';
import { getAuthenticatedUserDoc } from '@/lib/server/current-user';
import { isResumeSide } from '@/lib/utils/resume-helpers';
import { getAgentsByTeamLead } from '@/lib/services/user-service';
import type { ResumeProfile } from '@/lib/types';
import { Query } from 'node-appwrite';
import { listAllDocuments } from '@/lib/server/appwrite-pagination';

export interface DateRange {
  from?: string; // YYYY-MM-DD
  to?: string;   // YYYY-MM-DD
}

export interface ResumeDashboardData {
  topMetrics: {
    totalActive: number;
    inFormatting: number;
    inMarketing: number;
    placed: number;
  };
  stageDistribution: Array<{ name: string; value: number; fill: string }>;
  kpiRows: Array<{
    agentId: string;
    agentName: string;
    profilesAssigned: number;
    profilesMovedToMarketing: number;
    compliancePending: number;
    complianceApproved: number;
    avgTimeToMarketing: number; // in days
  }>;
  complianceOverview: {
    pending: number;
    approved: number;
  };
  recentActivities: Array<{
    id: string;
    profileId: string;
    candidateName: string;
    type: 'created' | 'marketing' | 'compliance_approved';
    timestamp: string;
    agentName: string;
  }>;
}

const STAGE_COLORS: Record<string, string> = {
  'Draft & Approval': '#94a3b8', // slate-400
  '1. Need Documents': '#f87171', // red-400
  '2. Formatting': '#fbbf24', // amber-400
  '3. Technical': '#34d399', // emerald-400
  '4. Marketing': '#a78bfa', // violet-400
  'Marketing': '#a78bfa',
  'Placed': '#38bdf8', // sky-400
};

export async function getResumeDashboardDataAction(
  dateRange: DateRange
): Promise<ResumeDashboardData> {
  const actor = await getAuthenticatedUserDoc();
  if (!actor || !isResumeSide(actor)) {
    throw new Error('Unauthorized');
  }

  const { databases } = await createAdminClient();

  // Determine visibility scope
  const queries = [];
  
  if (actor.role === 'admin' || actor.role === 'monitor' || actor.role === 'operations' || actor.role === 'compliance') {
    // Admins and compliance see all
  } else if (actor.role === 'team_lead') {
    const agents = await getAgentsByTeamLead(actor.$id, 'resume');
    const teamIds = agents.map(a => a.$id);
    teamIds.push(actor.$id); // include self
    queries.push(Query.equal('assignedToId', teamIds));
  } else {
    // Agents see only themselves
    queries.push(Query.equal('assignedToId', actor.$id));
  }
  
  const allProfiles = await listAllDocuments<ResumeProfile>({
    databases,
    databaseId: DATABASE_ID,
    collectionId: COLLECTIONS.RESUME_PROFILES,
    queries
  });

  const fromDate = dateRange.from ? new Date(`${dateRange.from}T00:00:00.000Z`) : new Date(0);
  const toDate = dateRange.to ? new Date(`${dateRange.to}T23:59:59.999Z`) : new Date();

  const isWithinRange = (dateString?: string | null) => {
    if (!dateString) return false;
    const d = new Date(dateString);
    return d >= fromDate && d <= toDate;
  };

  const dashboardData: ResumeDashboardData = {
    topMetrics: { totalActive: 0, inFormatting: 0, inMarketing: 0, placed: 0 },
    stageDistribution: [],
    kpiRows: [],
    complianceOverview: { pending: 0, approved: 0 },
    recentActivities: [],
  };

  const stageCounts: Record<string, number> = {};
  const agentMap = new Map<string, {
    agentId: string;
    agentName: string;
    profilesAssigned: number;
    profilesMovedToMarketing: number;
    compliancePending: number;
    complianceApproved: number;
    _totalTimeToMarketing: number; // For average calculation
  }>();
  
  const allActivities: ResumeDashboardData['recentActivities'] = [];

  for (const doc of allProfiles) {
    const stage = doc.stage || 'Unknown';
    const assignedId = doc.assignedToId || 'unassigned';
    const assignedName = doc.assignedToName || 'Unassigned';
    const candidateName = doc.candidateName || 'Unknown Candidate';
    const createdAt = doc.createdAt;
    const marketingMovedAt = doc.marketingMovedAt;
    const complianceStatus = doc.complianceStatus;
    const complianceApprovedAt = doc.complianceApprovedAt;
    
    stageCounts[stage as string] = (stageCounts[stage as string] || 0) + 1;

    if (stage !== 'Placed' && stage !== 'Closed') dashboardData.topMetrics.totalActive++;
    if (stage === '2. Formatting') dashboardData.topMetrics.inFormatting++;
    if (stage === '4. Marketing' || stage === 'Marketing') dashboardData.topMetrics.inMarketing++;
    if (stage === 'Placed') dashboardData.topMetrics.placed++;

    if (complianceStatus === 'pending') dashboardData.complianceOverview.pending++;
    if (complianceStatus === 'approved') dashboardData.complianceOverview.approved++;

    if (!agentMap.has(assignedId)) {
      agentMap.set(assignedId, {
        agentId: assignedId,
        agentName: assignedName,
        profilesAssigned: 0,
        profilesMovedToMarketing: 0,
        compliancePending: 0,
        complianceApproved: 0,
        _totalTimeToMarketing: 0,
      });
    }
    const agentStats = agentMap.get(assignedId)!;
    
    if (isWithinRange(createdAt)) {
      agentStats.profilesAssigned++;
      allActivities.push({
        id: `${doc.$id}-created`,
        profileId: doc.$id,
        candidateName,
        type: 'created',
        timestamp: createdAt,
        agentName: assignedName,
      });
    }

    if (doc.movedToMarketing && isWithinRange(marketingMovedAt)) {
      agentStats.profilesMovedToMarketing++;
      
      // Calculate time to marketing
      if (createdAt && marketingMovedAt) {
        const timeDiff = new Date(marketingMovedAt).getTime() - new Date(createdAt).getTime();
        agentStats._totalTimeToMarketing += timeDiff;
      }
      
      allActivities.push({
        id: `${doc.$id}-marketing`,
        profileId: doc.$id,
        candidateName,
        type: 'marketing',
        timestamp: marketingMovedAt as string,
        agentName: assignedName,
      });
    }

    if (complianceStatus === 'pending') agentStats.compliancePending++;
    if (complianceStatus === 'approved') agentStats.complianceApproved++;
    
    if (complianceStatus === 'approved' && isWithinRange(complianceApprovedAt)) {
      allActivities.push({
        id: `${doc.$id}-compliance`,
        profileId: doc.$id,
        candidateName,
        type: 'compliance_approved',
        timestamp: complianceApprovedAt as string,
        agentName: assignedName,
      });
    }
  }

  for (const [stage, count] of Object.entries(stageCounts)) {
    if (stage === 'Marketing' && count === 0) continue;
    dashboardData.stageDistribution.push({
      name: stage,
      value: count,
      fill: STAGE_COLORS[stage] || 'hsl(var(--chart-6))'
    });
  }

  dashboardData.kpiRows = Array.from(agentMap.values()).map(stats => {
    const avgMs = stats.profilesMovedToMarketing > 0 ? (stats._totalTimeToMarketing / stats.profilesMovedToMarketing) : 0;
    const avgDays = avgMs / (1000 * 60 * 60 * 24);
    
    return {
      agentId: stats.agentId,
      agentName: stats.agentName,
      profilesAssigned: stats.profilesAssigned,
      profilesMovedToMarketing: stats.profilesMovedToMarketing,
      compliancePending: stats.compliancePending,
      complianceApproved: stats.complianceApproved,
      avgTimeToMarketing: Number(avgDays.toFixed(1)),
    };
  }).sort((a, b) => b.profilesMovedToMarketing - a.profilesMovedToMarketing || b.profilesAssigned - a.profilesAssigned);
  
  // Sort activities by most recent and take top 10
  dashboardData.recentActivities = allActivities
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, 10);

  return dashboardData;
}
