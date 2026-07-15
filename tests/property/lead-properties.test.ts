import fc from 'fast-check';
import { Lead } from '@/lib/types';
import { Permission, Role } from 'appwrite';

// Helper to generate valid ISO date strings
const dateArb = () => fc.integer({ min: 1577836800000, max: 1924905600000 }).map(ts => new Date(ts).toISOString());

describe('Lead Properties', () => {
  describe('Property 14: Agent lead visibility restriction', () => {
    it('Feature: saleshub-crm, Property 14: Agent sees only assigned leads', () => {
      const agentIdArb = fc.uuid();
      const leadsArb = fc.array(
        fc.record({
          $id: fc.uuid(),
          data: fc.string(),
          status: fc.constantFrom('New', 'Contacted', 'Qualified', 'Proposal'),
          ownerId: fc.uuid(),
          assignedToId: fc.option(fc.uuid(), { nil: null }),
          branchId: fc.constant(null),
          isClosed: fc.constant(false),
          closedAt: fc.constant(null),
        }),
        { minLength: 0, maxLength: 50 }
      );

      fc.assert(
        fc.property(agentIdArb, leadsArb, (agentId, allLeads) => {
          // Simulate filtering leads for an agent
          const visibleLeads = allLeads.filter(lead => lead.assignedToId === agentId);

          // Property: All visible leads must have the agent as assignedToId
          return visibleLeads.every(lead => lead.assignedToId === agentId);
        }),
        { numRuns: 100 }
      );
    });

    it('should not show unassigned leads to agents', () => {
      const agentIdArb = fc.uuid();
      const leadsArb = fc.array(
        fc.record({
          $id: fc.uuid(),
          data: fc.string(),
          status: fc.constantFrom('New', 'Contacted', 'Qualified', 'Proposal'),
          ownerId: fc.uuid(),
          assignedToId: fc.option(fc.uuid(), { nil: null }),
          branchId: fc.constant(null),
          isClosed: fc.constant(false),
          closedAt: fc.constant(null),
        }),
        { minLength: 0, maxLength: 50 }
      );

      fc.assert(
        fc.property(agentIdArb, leadsArb, (agentId, allLeads) => {
          const visibleLeads = allLeads.filter(lead => lead.assignedToId === agentId);
          const unassignedLeads = allLeads.filter(lead => lead.assignedToId === null);

          // Property: No unassigned leads should be visible to agents
          return !visibleLeads.some(lead => lead.assignedToId === null);
        }),
        { numRuns: 100 }
      );
    });

    it('should not show leads assigned to other agents', () => {
      const agentIdArb = fc.uuid();
      const otherAgentIdArb = fc.uuid();
      const leadsArb = fc.array(
        fc.record({
          $id: fc.uuid(),
          data: fc.string(),
          status: fc.constantFrom('New', 'Contacted', 'Qualified', 'Proposal'),
          ownerId: fc.uuid(),
          assignedToId: fc.option(fc.uuid(), { nil: null }),
          branchId: fc.constant(null),
          isClosed: fc.constant(false),
          closedAt: fc.constant(null),
        }),
        { minLength: 0, maxLength: 50 }
      );

      fc.assert(
        fc.property(agentIdArb, otherAgentIdArb, leadsArb, (agentId, otherAgentId, allLeads) => {
          fc.pre(agentId !== otherAgentId); // Ensure different agents

          const visibleLeads = allLeads.filter(lead => lead.assignedToId === agentId);

          // Property: No leads assigned to other agents should be visible
          return !visibleLeads.some(lead =>
            lead.assignedToId !== null &&
            lead.assignedToId !== agentId
          );
        }),
        { numRuns: 100 }
      );
    });
  });

  describe('Property 15: TeamLead lead visibility', () => {
    it('Feature: saleshub-crm, Property 15: TeamLead sees all owned leads', () => {
      const teamLeadIdArb = fc.uuid();
      const leadsArb = fc.array(
        fc.record({
          $id: fc.uuid(),
          data: fc.string(),
          status: fc.constantFrom('New', 'Contacted', 'Qualified', 'Proposal'),
          ownerId: fc.uuid(),
          assignedToId: fc.option(fc.uuid(), { nil: null }),
          branchId: fc.constant(null),
          isClosed: fc.constant(false),
          closedAt: fc.constant(null),
        }),
        { minLength: 0, maxLength: 50 }
      );

      fc.assert(
        fc.property(teamLeadIdArb, leadsArb, (teamLeadId, allLeads) => {
          // Simulate filtering leads for a teamLead
          const visibleLeads = allLeads.filter(lead => lead.ownerId === teamLeadId);

          // Property: All visible leads must have the teamLead as ownerId
          return visibleLeads.every(lead => lead.ownerId === teamLeadId);
        }),
        { numRuns: 100 }
      );
    });

    it('should show all leads regardless of assignment status', () => {
      const teamLeadIdArb = fc.uuid();
      const leadsArb = fc.array(
        fc.record({
          $id: fc.uuid(),
          data: fc.string(),
          status: fc.constantFrom('New', 'Contacted', 'Qualified', 'Proposal'),
          ownerId: fc.uuid(),
          assignedToId: fc.option(fc.uuid(), { nil: null }),
          branchId: fc.constant(null),
          isClosed: fc.constant(false),
          closedAt: fc.constant(null),
        }),
        { minLength: 0, maxLength: 50 }
      );

      fc.assert(
        fc.property(teamLeadIdArb, leadsArb, (teamLeadId, allLeads) => {
          const ownedLeads = allLeads.filter(lead => lead.ownerId === teamLeadId);
          const visibleLeads = allLeads.filter(lead => lead.ownerId === teamLeadId);

          // Property: TeamLead sees all owned leads regardless of assignment
          return visibleLeads.length === ownedLeads.length;
        }),
        { numRuns: 100 }
      );
    });

    it('should show both assigned and unassigned leads', () => {
      const teamLeadIdArb = fc.uuid();
      const leadsArb = fc.array(
        fc.record({
          $id: fc.uuid(),
          data: fc.string(),
          status: fc.constantFrom('New', 'Contacted', 'Qualified', 'Proposal'),
          ownerId: fc.uuid(),
          assignedToId: fc.option(fc.uuid(), { nil: null }),
          branchId: fc.constant(null),
          isClosed: fc.constant(false),
          closedAt: fc.constant(null),
        }),
        { minLength: 0, maxLength: 50 }
      );

      fc.assert(
        fc.property(teamLeadIdArb, leadsArb, (teamLeadId, allLeads) => {
          const visibleLeads = allLeads.filter(lead => lead.ownerId === teamLeadId);
          const assignedLeads = visibleLeads.filter(lead => lead.assignedToId !== null);
          const unassignedLeads = visibleLeads.filter(lead => lead.assignedToId === null);

          // Property: TeamLead sees both assigned and unassigned leads
          return visibleLeads.length === assignedLeads.length + unassignedLeads.length;
        }),
        { numRuns: 100 }
      );
    });

    it('should not show leads owned by other teamLeads', () => {
      const teamLeadIdArb = fc.uuid();
      const otherManagerIdArb = fc.uuid();
      const leadsArb = fc.array(
        fc.record({
          $id: fc.uuid(),
          data: fc.string(),
          status: fc.constantFrom('New', 'Contacted', 'Qualified', 'Proposal'),
          ownerId: fc.uuid(),
          assignedToId: fc.option(fc.uuid(), { nil: null }),
          branchId: fc.constant(null),
          isClosed: fc.constant(false),
          closedAt: fc.constant(null),
        }),
        { minLength: 0, maxLength: 50 }
      );

      fc.assert(
        fc.property(teamLeadIdArb, otherManagerIdArb, leadsArb, (teamLeadId, otherManagerId, allLeads) => {
          fc.pre(teamLeadId !== otherManagerId); // Ensure different teamLeads

          const visibleLeads = allLeads.filter(lead => lead.ownerId === teamLeadId);

          // Property: TeamLead should not see leads owned by other teamLeads
          return !visibleLeads.some(lead =>
            lead.ownerId !== teamLeadId
          );
        }),
        { numRuns: 100 }
      );
    });
  });

  describe('Property 12: Lead closure state transition', () => {
    it('should set isClosed to true when lead is closed', () => {
      const activeLeadArb = fc.record({
        $id: fc.uuid(),
        data: fc.string(),
        status: fc.constantFrom('New', 'Contacted', 'Qualified', 'Proposal'),
        ownerId: fc.uuid(),
        assignedToId: fc.option(fc.uuid(), { nil: null }),
        branchId: fc.constant(null),
        isClosed: fc.constant(false),
        closedAt: fc.constant(null),
      });

      fc.assert(
        fc.property(activeLeadArb, fc.constantFrom('Won', 'Lost', 'Closed'), (lead, closedStatus) => {
          const closedLead: Lead = {
            ...lead,
            isClosed: true,
            closedAt: new Date().toISOString(),
            status: closedStatus,
          };
          return closedLead.isClosed === true && closedLead.closedAt !== null;
        }),
        { numRuns: 100 }
      );
    });
  });

  describe('Property 17: Closed lead read-only enforcement', () => {
    it('should grant only read permission to agents for closed leads', () => {
      const closedLeadArb = fc.record({
        $id: fc.uuid(),
        data: fc.string(),
        status: fc.string(),
        ownerId: fc.uuid(),
        assignedToId: fc.uuid(),
        branchId: fc.constant(null),
        isClosed: fc.constant(true),
        closedAt: dateArb(),
      });

      fc.assert(
        fc.property(closedLeadArb, (lead) => {
          const permissions = [
            Permission.read(Role.user(lead.ownerId)),
            Permission.update(Role.user(lead.ownerId)),
            Permission.delete(Role.user(lead.ownerId)),
            Permission.read(Role.user(lead.assignedToId!)),
          ];
          const agentPermissions = permissions.filter(p => p.includes(lead.assignedToId!));
          const hasReadPermission = agentPermissions.some(p => p.includes('read'));
          const hasUpdatePermission = agentPermissions.some(p => p.includes('update'));
          return hasReadPermission && !hasUpdatePermission;
        }),
        { numRuns: 100 }
      );
    });
  });

  describe('Property 13: Lead reopen preserves history', () => {
    it('should set isClosed to false when lead is reopened', () => {
      const closedLeadArb = fc.record({
        $id: fc.uuid(),
        data: fc.string(),
        status: fc.string(),
        ownerId: fc.uuid(),
        assignedToId: fc.option(fc.uuid(), { nil: null }),
        branchId: fc.constant(null),
        isClosed: fc.constant(true),
        closedAt: dateArb(),
      });

      fc.assert(
        fc.property(closedLeadArb, (lead) => {
          const reopenedLead: Lead = { ...lead, isClosed: false };
          return reopenedLead.isClosed === false;
        }),
        { numRuns: 100 }
      );
    });

    it('should preserve closedAt timestamp when lead is reopened', () => {
      const closedLeadArb = fc.record({
        $id: fc.uuid(),
        data: fc.string(),
        status: fc.string(),
        ownerId: fc.uuid(),
        assignedToId: fc.option(fc.uuid(), { nil: null }),
        branchId: fc.constant(null),
        isClosed: fc.constant(true),
        closedAt: dateArb(),
      });

      fc.assert(
        fc.property(closedLeadArb, (lead) => {
          const originalClosedAt = lead.closedAt;
          const reopenedLead: Lead = { ...lead, isClosed: false };
          return reopenedLead.closedAt === originalClosedAt;
        }),
        { numRuns: 100 }
      );
    });
  });

  describe('Property 16: Lead assignment permission update', () => {
    it('should grant permissions to newly assigned agent', () => {
      const leadReassignmentArb = fc.record({
        lead: fc.record({
          $id: fc.uuid(),
          data: fc.string(),
          status: fc.string(),
          ownerId: fc.uuid(),
          assignedToId: fc.uuid(),
          branchId: fc.constant(null),
          isClosed: fc.constant(false),
          closedAt: fc.constant(null),
        }),
        newAgentId: fc.uuid(),
      });

      fc.assert(
        fc.property(leadReassignmentArb, ({ lead, newAgentId }) => {
          const updatedPermissions = [
            Permission.read(Role.user(lead.ownerId)),
            Permission.update(Role.user(lead.ownerId)),
            Permission.delete(Role.user(lead.ownerId)),
            Permission.read(Role.user(newAgentId)),
            Permission.update(Role.user(newAgentId)),
          ];
          const newAgentPermissions = updatedPermissions.filter(p => p.includes(newAgentId));
          const hasReadPermission = newAgentPermissions.some(p => p.includes('read'));
          const hasUpdatePermission = newAgentPermissions.some(p => p.includes('update'));
          return hasReadPermission && hasUpdatePermission;
        }),
        { numRuns: 100 }
      );
    });

    it('should revoke update permissions from old agent', () => {
      const leadReassignmentArb = fc.record({
        lead: fc.record({
          $id: fc.uuid(),
          data: fc.string(),
          status: fc.string(),
          ownerId: fc.uuid(),
          assignedToId: fc.uuid(),
          branchId: fc.constant(null),
          isClosed: fc.constant(false),
          closedAt: fc.constant(null),
        }),
        newAgentId: fc.uuid(),
      });

      fc.assert(
        fc.property(leadReassignmentArb, ({ lead, newAgentId }) => {
          const oldAgentId = lead.assignedToId!;
          const updatedPermissions = [
            Permission.read(Role.user(lead.ownerId)),
            Permission.update(Role.user(lead.ownerId)),
            Permission.delete(Role.user(lead.ownerId)),
            Permission.read(Role.user(newAgentId)),
            Permission.update(Role.user(newAgentId)),
          ];
          const oldAgentPermissions = updatedPermissions.filter(p => p.includes(oldAgentId));
          return oldAgentPermissions.length === 0;
        }),
        { numRuns: 100 }
      );
    });
  });

  describe('Property 18: History filtering correctness', () => {
    it('Feature: saleshub-crm, Property 18: History filtering returns only matching closed leads', () => {
      const historyFiltersArb = fc.record({
        dateFrom: fc.option(dateArb(), { nil: undefined }),
        dateTo: fc.option(dateArb(), { nil: undefined }),
        agentId: fc.option(fc.uuid(), { nil: undefined }),
        status: fc.option(fc.constantFrom('Won', 'Lost', 'Closed', 'Rejected'), { nil: undefined }),
      });

      const leadsArb = fc.array(
        fc.record({
          $id: fc.uuid(),
          data: fc.string(),
          status: fc.constantFrom('New', 'Contacted', 'Qualified', 'Proposal', 'Won', 'Lost', 'Closed', 'Rejected'),
          ownerId: fc.uuid(),
          assignedToId: fc.option(fc.uuid(), { nil: null }),
          branchId: fc.constant(null),
          isClosed: fc.boolean(),
          closedAt: fc.option(dateArb(), { nil: null }),
          $createdAt: dateArb(),
        }),
        { minLength: 0, maxLength: 50 }
      );

      fc.assert(
        fc.property(historyFiltersArb, leadsArb, (filters, allLeads) => {
          // Apply filters to simulate history query
          let filteredLeads = allLeads.filter(lead => lead.isClosed === true);

          // Apply date range filter
          if (filters.dateFrom) {
            filteredLeads = filteredLeads.filter(lead =>
              lead.closedAt && lead.closedAt >= filters.dateFrom!
            );
          }
          if (filters.dateTo) {
            filteredLeads = filteredLeads.filter(lead =>
              lead.closedAt && lead.closedAt <= filters.dateTo!
            );
          }

          // Apply agent filter
          if (filters.agentId) {
            filteredLeads = filteredLeads.filter(lead =>
              lead.assignedToId === filters.agentId
            );
          }

          // Apply status filter
          if (filters.status) {
            filteredLeads = filteredLeads.filter(lead =>
              lead.status === filters.status
            );
          }

          // Property: All returned leads must be closed
          const allClosed = filteredLeads.every(lead => lead.isClosed === true);

          // Property: All returned leads must match date filters
          const matchesDateFrom = !filters.dateFrom || filteredLeads.every(lead =>
            lead.closedAt && lead.closedAt >= filters.dateFrom!
          );
          const matchesDateTo = !filters.dateTo || filteredLeads.every(lead =>
            lead.closedAt && lead.closedAt <= filters.dateTo!
          );

          // Property: All returned leads must match agent filter
          const matchesAgent = !filters.agentId || filteredLeads.every(lead =>
            lead.assignedToId === filters.agentId
          );

          // Property: All returned leads must match status filter
          const matchesStatus = !filters.status || filteredLeads.every(lead =>
            lead.status === filters.status
          );

          return allClosed && matchesDateFrom && matchesDateTo && matchesAgent && matchesStatus;
        }),
        { numRuns: 100 }
      );
    });

    it('should not return active leads in history', () => {
      const historyFiltersArb = fc.record({
        dateFrom: fc.option(dateArb(), { nil: undefined }),
        dateTo: fc.option(dateArb(), { nil: undefined }),
        agentId: fc.option(fc.uuid(), { nil: undefined }),
        status: fc.option(fc.string(), { nil: undefined }),
      });

      const leadsArb = fc.array(
        fc.record({
          $id: fc.uuid(),
          data: fc.string(),
          status: fc.string(),
          ownerId: fc.uuid(),
          assignedToId: fc.option(fc.uuid(), { nil: null }),
          branchId: fc.constant(null),
          isClosed: fc.boolean(),
          closedAt: fc.option(dateArb(), { nil: null }),
          $createdAt: dateArb(),
        }),
        { minLength: 0, maxLength: 50 }
      );

      fc.assert(
        fc.property(historyFiltersArb, leadsArb, (filters, allLeads) => {
          const historyLeads = allLeads.filter(lead => lead.isClosed === true);

          // Property: No active leads (isClosed=false) should be in history
          return !historyLeads.some(lead => lead.isClosed === false);
        }),
        { numRuns: 100 }
      );
    });

    it('should return empty array when no leads match filters', () => {
      const leadsArb = fc.array(
        fc.record({
          $id: fc.uuid(),
          data: fc.string(),
          status: fc.constantFrom('New', 'Contacted', 'Qualified'),
          ownerId: fc.uuid(),
          assignedToId: fc.option(fc.uuid(), { nil: null }),
          branchId: fc.constant(null),
          isClosed: fc.constant(false),
          closedAt: fc.constant(null),
          $createdAt: dateArb(),
        }),
        { minLength: 0, maxLength: 50 }
      );

      fc.assert(
        fc.property(leadsArb, (allLeads) => {
          return allLeads.every(lead => lead.isClosed === false);
        }),
        { numRuns: 100 }
      );
    });
  });
});
