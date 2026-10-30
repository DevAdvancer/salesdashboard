import fc from 'fast-check';
import { getAgentPaymentDetailsAction } from '@/app/actions/agent-payment-details';

let mockRole = 'agent';
const mockListAll = jest.fn();
jest.mock('node-appwrite', () => ({ Query: {} }));
jest.mock('@/lib/server/current-user', () => ({ assertAuthenticatedUserId: jest.fn() }));
jest.mock('@/lib/server/appwrite', () => ({ createAdminClient: async () => ({ databases: {
  getDocument: async () => ({ $id: 'viewer', role: mockRole, name: 'Viewer', department: 'sales' }),
} }) }));
jest.mock('@/lib/server/appwrite-pagination', () => ({ listAllDocuments: (...args: unknown[]) => mockListAll(...args) }));
jest.mock('@/lib/services/user-service', () => ({ getAgentsByTeamLead: async () => [] }));

test('unassigned manual payment details never expose unattributed data to non-leadership roles', async () => {
  await fc.assert(fc.asyncProperty(fc.constantFrom('agent', 'team_lead', 'lead_generation', 'senior_tl', 'compliance'), async role => {
    mockRole = role;
    await expect(getAgentPaymentDetailsAction({ actorId: 'viewer', agentId: 'unassigned-followups', monthKey: '2026-07' }))
      .rejects.toThrow('Not authorized');
    expect(mockListAll).not.toHaveBeenCalled();
  }), { numRuns: 20 });
});
