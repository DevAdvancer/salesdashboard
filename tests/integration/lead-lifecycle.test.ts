/**
 * Integration Test: Complete Lead Lifecycle
 *
 * Tests the full lead lifecycle flow:
 * create → assign → edit → close → reopen
 *
 * Requirements: All lead-related requirements (4.1-4.7, 5.1-5.6, 6.2-6.4, 7.1-7.6)
 */

import {
  createLead,
  updateLead,
  getLead,
  listLeads,
  closeLead,
  reopenLead,
  assignLead,
} from '@/lib/services/lead-service';
import { databases } from '@/lib/appwrite';
import { Permission, Role } from 'appwrite';
import { Lead, LeadData } from '@/lib/types';
import {
  LEAD_STATUS_PIPELINE,
  LEAD_STATUS_SIGNED_CLOSURE,
} from '@/lib/utils/lead-status-workflow';

jest.mock('@/lib/appwrite', () => ({
  account: {
    create: jest.fn(),
    get: jest.fn(),
  },
  databases: {
    createDocument: jest.fn(),
    getDocument: jest.fn(),
    updateDocument: jest.fn(),
    deleteDocument: jest.fn(),
    listDocuments: jest.fn(),
  },
  invalidateCollectionReads: jest.fn(),
  DATABASE_ID: 'test-database',
  COLLECTIONS: {
    LEADS: 'test-leads-collection',
    USERS: 'test-users-collection',
  },
}));

// Mock the lead validator to always return valid by default
jest.mock('@/lib/services/lead-validator', () => ({
  validateLeadUniqueness: jest.fn().mockResolvedValue({ isValid: true }),
}));

describe('Integration: Complete Lead Lifecycle', () => {
  const teamLeadId = 'teamLead-001';
  const agentId = 'agent-001';
  const newAgentId = 'agent-002';

  // lib/services/user-service.ts reads USERS from
  // NEXT_PUBLIC_APPWRITE_USERS_COLLECTION_ID, which jest.env.js pins to this value.
  const USERS_COLLECTION = 'test-users-collection';

  // createLead and listLeads both resolve the acting user through
  // getUserById, so the Appwrite mock has to serve the users collection as
  // well as the leads collection. Returning a lead document for every
  // getDocument call made mapDocToUser blow up on an undefined document.
  const userDocs: Record<string, Record<string, unknown>> = {
    [teamLeadId]: {
      $id: teamLeadId,
      name: 'Test Team Lead',
      email: 'tl@example.com',
      role: 'team_lead',
      teamLeadId: null,
      branchIds: ['branch-1'],
    },
    [agentId]: {
      $id: agentId,
      name: 'Test Agent',
      email: 'agent@example.com',
      role: 'agent',
      teamLeadId: teamLeadId,
      branchIds: ['branch-1'],
    },
    [newAgentId]: {
      $id: newAgentId,
      name: 'Second Agent',
      email: 'agent2@example.com',
      role: 'agent',
      teamLeadId: teamLeadId,
      branchIds: ['branch-1'],
    },
  };

  function notFound() {
    return Object.assign(new Error('Document with the requested ID could not be found.'), {
      code: 404,
    });
  }

  /**
   * Point databases.getDocument at the given lead while keeping user lookups working.
   */
  function mockLeadDocument(lead: Lead | null) {
    (databases.getDocument as jest.Mock).mockImplementation(
      async (_databaseId: string, collectionId: string, documentId: string) => {
        if (collectionId === USERS_COLLECTION) {
          const doc = userDocs[documentId];
          if (!doc) throw notFound();
          return doc;
        }
        if (!lead) throw notFound();
        return lead;
      }
    );
  }

  const leadData: LeadData = {
    firstName: 'Alice',
    lastName: 'Johnson',
    email: 'alice@example.com',
    phone: '+1234567890',
    company: 'TechCorp',
    status: 'Interested',
  };

  let currentLead: Lead;

  beforeEach(() => {
    jest.clearAllMocks();
    mockLeadDocument(null);
  });

  it('should complete the full lead lifecycle: create → assign → edit → close → reopen', async () => {
    // Step 1: TeamLead creates a lead
    const createdLead: Lead = {
      $id: 'lead-lifecycle-1',
      data: JSON.stringify(leadData),
      status: 'Interested',
      ownerId: teamLeadId,
      assignedToId: null,
      branchId: null,
      isClosed: false,
      closedAt: null,
      $createdAt: new Date().toISOString(),
      $updatedAt: new Date().toISOString(),
    };

    (databases.createDocument as jest.Mock).mockResolvedValue(createdLead);

    currentLead = await createLead(teamLeadId, {
      data: leadData,
      status: 'Interested',
    });

    expect(currentLead.$id).toBe('lead-lifecycle-1');
    expect(currentLead.isClosed).toBe(false);
    expect(currentLead.assignedToId).toBeNull();
    expect(databases.createDocument).toHaveBeenCalledWith(
      'test-database',
      'test-leads-collection',
      'unique()',
      expect.objectContaining({
        ownerId: teamLeadId,
        branchId: null,
        isClosed: false,
      }),
      expect.arrayContaining([
        Permission.read(Role.user(teamLeadId)),
        Permission.update(Role.user(teamLeadId)),
        Permission.delete(Role.user(teamLeadId)),
      ])
    );

    // Step 2: TeamLead assigns lead to agent
    const assignedLead: Lead = {
      ...currentLead,
      assignedToId: agentId,
    };

    mockLeadDocument(currentLead);
    (databases.updateDocument as jest.Mock).mockResolvedValue(assignedLead);

    currentLead = await assignLead(currentLead.$id, agentId);

    expect(currentLead.assignedToId).toBe(agentId);
    expect(databases.updateDocument).toHaveBeenCalledWith(
      'test-database',
      'test-leads-collection',
      'lead-lifecycle-1',
      { assignedToId: agentId },
      expect.arrayContaining([
        Permission.read(Role.user(agentId)),
        Permission.update(Role.user(agentId)),
      ])
    );

    // Step 3: Agent edits the lead data.
    // 'Interested' only transitions to itself or to 'Pipeline / Follow up'
    // (lib/utils/lead-status-workflow.ts). The old 'Contacted' status is not
    // part of the workflow at all, so updateLead rejected the transition.
    const editedData: LeadData = {
      ...leadData,
      status: LEAD_STATUS_PIPELINE,
      phone: '+9876543210',
    };

    const editedLead: Lead = {
      ...currentLead,
      data: JSON.stringify(editedData),
      status: LEAD_STATUS_PIPELINE,
    };

    mockLeadDocument(currentLead);
    (databases.updateDocument as jest.Mock).mockResolvedValue(editedLead);

    currentLead = await updateLead(currentLead.$id, {
      status: LEAD_STATUS_PIPELINE,
      phone: '+9876543210',
    });

    expect(currentLead.status).toBe(LEAD_STATUS_PIPELINE);

    // Step 4: Close the lead
    const closedLead: Lead = {
      ...currentLead,
      isClosed: true,
      closedAt: '2026-02-10T12:00:00.000Z',
      status: LEAD_STATUS_SIGNED_CLOSURE,
    };

    mockLeadDocument(currentLead);
    (databases.updateDocument as jest.Mock).mockResolvedValue(closedLead);

    currentLead = await closeLead(
      currentLead.$id,
      LEAD_STATUS_SIGNED_CLOSURE,
      teamLeadId,
      'TeamLead',
      'team_lead'
    );

    expect(currentLead.isClosed).toBe(true);
    expect(currentLead.closedAt).toBeTruthy();
    expect(currentLead.status).toBe(LEAD_STATUS_SIGNED_CLOSURE);

    // Verify agent gets read-only permissions on close
    const closeCallArgs = (databases.updateDocument as jest.Mock).mock.calls[
      (databases.updateDocument as jest.Mock).mock.calls.length - 1
    ];
    const closePermissions = closeCallArgs[4];
    const agentUpdateOnClose = closePermissions.filter(
      (p: string) => p.includes(agentId) && p.includes('update')
    );
    expect(agentUpdateOnClose).toHaveLength(0);

    // Step 5: Verify lead appears in history (closed leads list)
    (databases.listDocuments as jest.Mock).mockResolvedValue({
      documents: [currentLead],
    });

    const closedLeads = await listLeads({ isClosed: true }, teamLeadId, 'team_lead');
    expect(closedLeads).toHaveLength(1);
    expect(closedLeads[0].isClosed).toBe(true);

    // Step 6: TeamLead reopens the lead
    const reopenedLead: Lead = {
      ...currentLead,
      isClosed: false,
      // closedAt preserved for audit trail
    };

    mockLeadDocument(currentLead);
    (databases.updateDocument as jest.Mock).mockResolvedValue(reopenedLead);

    currentLead = await reopenLead(currentLead.$id);

    expect(currentLead.isClosed).toBe(false);

    // Verify agent update permissions restored
    const reopenCallArgs = (databases.updateDocument as jest.Mock).mock.calls[
      (databases.updateDocument as jest.Mock).mock.calls.length - 1
    ];
    const reopenPermissions = reopenCallArgs[4];
    const agentUpdateOnReopen = reopenPermissions.filter(
      (p: string) => p.includes(agentId) && p.includes('update')
    );
    expect(agentUpdateOnReopen).toHaveLength(1);
  });

  it('should enforce agent visibility: agent sees only assigned leads', async () => {
    const allLeads: Lead[] = [
      {
        $id: 'lead-a',
        data: JSON.stringify({ firstName: 'A' }),
        status: 'New',
        ownerId: teamLeadId,
        assignedToId: agentId,
        branchId: null,
        isClosed: false,
        closedAt: null,
      },
      {
        $id: 'lead-b',
        data: JSON.stringify({ firstName: 'B' }),
        status: 'New',
        ownerId: teamLeadId,
        assignedToId: newAgentId,
        branchId: null,
        isClosed: false,
        closedAt: null,
      },
    ];

    // Agent query returns only their assigned leads
    (databases.listDocuments as jest.Mock).mockResolvedValue({
      documents: [allLeads[0]],
    });

    const agentLeads = await listLeads({}, agentId, 'agent');
    expect(agentLeads).toHaveLength(1);
    expect(agentLeads[0].assignedToId).toBe(agentId);

    // TeamLead query returns all owned leads
    (databases.listDocuments as jest.Mock).mockResolvedValue({
      documents: allLeads,
    });

    const managerLeads = await listLeads({}, teamLeadId, 'team_lead');
    expect(managerLeads).toHaveLength(2);
  });

  it('should handle lead reassignment correctly', async () => {
    const lead: Lead = {
      $id: 'lead-reassign',
      data: JSON.stringify(leadData),
      status: 'New',
      ownerId: teamLeadId,
      assignedToId: agentId,
      branchId: null,
      isClosed: false,
      closedAt: null,
    };

    const reassignedLead: Lead = {
      ...lead,
      assignedToId: newAgentId,
    };

    mockLeadDocument(lead);
    (databases.updateDocument as jest.Mock).mockResolvedValue(reassignedLead);

    const result = await assignLead(lead.$id, newAgentId);

    expect(result.assignedToId).toBe(newAgentId);

    // Verify old agent removed from permissions, new agent added
    const callArgs = (databases.updateDocument as jest.Mock).mock.calls[0];
    const permissions: string[] = callArgs[4];

    const oldAgentPerms = permissions.filter((p) => p.includes(agentId));
    const newAgentPerms = permissions.filter((p) => p.includes(newAgentId));

    expect(oldAgentPerms).toHaveLength(0);
    expect(newAgentPerms.length).toBeGreaterThan(0);
  });
});
