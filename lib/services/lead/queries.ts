import { Query } from 'appwrite';
import { databases, DATABASE_ID, COLLECTIONS } from '@/lib/appwrite';
import { Lead, LeadData, LeadListFilters, UserRole } from '@/lib/types';
import { getUserById } from '@/lib/services/user-service';
import { getErrorMessage } from '@/lib/utils';
import { expandIsoDateToStart, expandIsoDateToEnd } from '@/lib/utils/iso-date-range';
import { getTeamLeadLeadVisibilityScope, appendTeamLeadLeadVisibilityQuery } from './visibility';

export async function getLead(leadId: string): Promise<Lead> {
  try {
    const lead = await databases.getDocument(DATABASE_ID, COLLECTIONS.LEADS, leadId);
    return lead as unknown as Lead;
  } catch (error: unknown) {
    console.error('Error fetching lead:', error);
    throw new Error(getErrorMessage(error, 'Failed to fetch lead'));
  }
}

export async function listLeads(
  filters: LeadListFilters,
  userId: string,
  userRole: UserRole,
  branchIds?: string[]
): Promise<Lead[]> {
  try {
    const queries: string[] = [];

    const currentUser = await getUserById(userId);
    if (userRole === 'agent') {
      const orConditions = [
          Query.equal('assignedToId', userId),
          Query.equal('ownerId', userId),
      ];
      queries.push(Query.or(orConditions));
    } else if (userRole === 'lead_generation') {
      queries.push(Query.equal('ownerId', userId));
    } else if (userRole === 'admin' || userRole === 'developer' || userRole === 'monitor' || userRole === 'operations') {
      // Admins, developers, monitors, and operations see all leads across all branches - no branch/owner filter
    } else if (userRole === 'team_lead') {
      const { ownerVisibleUserIds, assignmentVisibleUserIds } =
        await getTeamLeadLeadVisibilityScope(userId);
      appendTeamLeadLeadVisibilityQuery(
        queries,
        ownerVisibleUserIds,
        assignmentVisibleUserIds,
      );
    }

    if (filters.isClosed !== undefined) {
      queries.push(Query.equal('isClosed', filters.isClosed));
    } else {
      queries.push(Query.equal('isClosed', false));
    }

    const normalizedRequestedStatus =
      typeof filters.status === 'string'
        ? filters.status.trim().toLowerCase().replace(/[^a-z0-9]/g, '')
        : '';
    const shouldExcludeNotInterestedFromActiveList =
      (filters.isClosed === undefined || filters.isClosed === false) &&
      normalizedRequestedStatus !== 'notinterested';

    if (shouldExcludeNotInterestedFromActiveList) {
      queries.push(Query.notEqual('status', 'Not Interested'));
      queries.push(Query.notEqual('status', 'Not-Interested'));
    }

    if (filters.status) {
      queries.push(Query.equal('status', filters.status));
    }

    if (filters.assignedToId) {
      queries.push(Query.equal('assignedToId', filters.assignedToId));
    }

    if (filters.branchId) {
      queries.push(Query.equal('branchId', filters.branchId));
    }

    if (filters.dateFrom) {
      queries.push(Query.greaterThanEqual('$createdAt', expandIsoDateToStart(filters.dateFrom)));
    }
    if (filters.dateTo) {
      queries.push(Query.lessThanEqual('$createdAt', expandIsoDateToEnd(filters.dateTo)));
    }

    queries.push(Query.orderDesc('$createdAt'));
    queries.push(Query.limit(5000));

    const response = await databases.listDocuments(DATABASE_ID, COLLECTIONS.LEADS, queries);

    let leads = response.documents as unknown as Lead[];

    if (filters.searchQuery) {
      const searchLower = filters.searchQuery.toLowerCase();
      leads = leads.filter((lead) => {
        const data = JSON.parse(lead.data) as LeadData;
        return Object.values(data).some((value) =>
          String(value).toLowerCase().includes(searchLower)
        );
      });
    }

    return leads;
  } catch (error: unknown) {
    console.error('Error listing leads:', error);
    throw new Error(getErrorMessage(error, 'Failed to list leads'));
  }
}
