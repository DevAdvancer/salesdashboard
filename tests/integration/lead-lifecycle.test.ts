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

jest.mock('@/lib/appwrite', () => ({
  databases: {
    createDocument: jest.fn(),
    getDocument: jest.fn(),
    updateDocument: jest.fn(),
    deleteDocument: jest.fn(),
    listDocuments: jest.fn(),
  },
  DATABASE_ID: 'test-database',
  COLLECTIONS: {
    LEADS: 'test-leads-collection',
  },
}));

describe('Integration: Complete Lead Lifecycle', () => {
  const managerId = 'manager-001';
  const agentId = 'agent-001';
  const newAgentId = 'agent-002';

  const leadData: LeadData = {
    firstName: 'Alice',
    lastName: 'Johnson',
    email: 'alice@example.com',
    phone: '+1234567890',
    company: 'TechCorp',
    status: 'New',
  };

  let currentLead: Lead;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should complete the full lead lifecycle: create → assign → edit → close → reopen', async () => {
    // Step 1: Manager creates a lead
    const createdLead: Lead = {
      $id: 'lead-lifecycle-1',
      data: JSON.stringify(leadData),
      status: 'New',
      ownerId: managerId,
      assignedToId: null,
      isClosed: false,
      closedAt: null,
      $createdAt: new Date().toISOString(),
      $updatedAt: new Date().toISOString(),
    };

    (databases.createDocument as jest.Mock).mockResolvedValue(createdLead);

    currentLead = await createLead({
      data: leadData,
      ownerId: managerId,
      status: 'New',
    });

    expect(currentLead.$id).toBe('lead-lifecycle-1');
    expect(currentLead.isClosed).toBe(false);
    expect(currentLead.assignedToId).toBeNull();
    expect(databases.createDocument).toHaveBeenCalledWith(
      'test-database',
      'test-leads-collection',
      'unique()',
      expect.objectContaining({
        ownerId: managerId,
        isClosed: false,
      }),
      expect.arrayContaining([
        Permission.read(Role.user(managerId)),
        Permission.update(Role.user(managerId)),
        Permission.delete(Role.user(managerId)),
      ])
    );

    // Step 2: Manager assigns lead to agent
    const assignedLead: Lead = {
      ...currentLead,
      assignedToId: agentId,
    };

    (databases.getDocument as jest.Mock).mockResolvedValue(currentLead);
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

    // Step 3: Agent edits the lead data
    const editedData: LeadData = {
      ...leadData,
      status: 'Contacted',
      phone: '+9876543210',
    };

    const editedLead: Lead = {
      ...currentLead,
      data: JSON.stringify(editedData),
      status: 'Contacted',
    };

    (databases.getDocument as jest.Mock).mockResolvedValue(currentLead);
    (databases.updateDocument as jest.Mock).mockResolvedValue(editedLead);

    currentLead = await updateLead(currentLead.$id, {
      status: 'Contacted',
      phone: '+9876543210',
    });

    expect(currentLead.status).toBe('Contacted');

    // Step 4: Close the lead
    const closedLead: Lead = {
      ...currentLead,
      isClosed: true,
      closedAt: '2026-02-10T12:00:00.000Z',
      status: 'Won',
    };

    (databases.getDocument as jest.Mock).mockResolvedValue(currentLead);
    (databases.updateDocument as jest.Mock).mockResolvedValue(closedLead);

    currentLead = await closeLead(currentLead.$id, 'Won');

    expect(currentLead.isClosed).toBe(true);
    expect(currentLead.closedAt).toBeTruthy();
    expect(currentLead.status).toBe('Won');

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

    const closedLeads = await listLeads({ isClosed: true }, managerId, 'manager');
    expect(closedLeads).toHaveLength(1);
    expect(closedLeads[0].isClosed).toBe(true);

    // Step 6: Manager reopens the lead
    const reopenedLead: Lead = {
      ...currentLead,
      isClosed: false,
      // closedAt preserved for audit trail
    };

    (databases.getDocument as jest.Mock).mockResolvedValue(currentLead);
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
        ownerId: managerId,
        assignedToId: agentId,
        isClosed: false,
        closedAt: null,
      },
      {
        $id: 'lead-b',
        data: JSON.stringify({ firstName: 'B' }),
        status: 'New',
        ownerId: managerId,
        assignedToId: newAgentId,
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

    // Manager query returns all owned leads
    (databases.listDocuments as jest.Mock).mockResolvedValue({
      documents: allLeads,
    });

    const managerLeads = await listLeads({}, managerId, 'manager');
    expect(managerLeads).toHaveLength(2);
  });

  it('should handle lead reassignment correctly', async () => {
    const lead: Lead = {
      $id: 'lead-reassign',
      data: JSON.stringify(leadData),
      status: 'New',
      ownerId: managerId,
      assignedToId: agentId,
      isClosed: false,
      closedAt: null,
    };

    const reassignedLead: Lead = {
      ...lead,
      assignedToId: newAgentId,
    };

    (databases.getDocument as jest.Mock).mockResolvedValue(lead);
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
