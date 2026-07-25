import fc from 'fast-check';
import { createTeamLead, createAgent } from '@/lib/services/user-service';
import { account, databases } from '@/lib/appwrite';

/**
 * Feature: team-lead-role-hierarchy, Property 6: Hierarchy chain correctness
 *
 * The hierarchy is two tiers: a team lead sits at the top of a team and has no
 * supervisor of its own, and every agent created underneath a team lead points
 * back at that team lead.
 *
 * For any team lead created, the team lead's teamLeadId SHALL be null.
 * For any agent created under a team lead, the agent's teamLeadId SHALL equal
 * that team lead's user ID, and the agent's branchIds SHALL be a subset of the
 * team lead's branchIds.
 *
 * This file previously described a three tier manager -> team_lead -> agent
 * chain. That middle tier no longer exists in the domain (lib/types/index.ts
 * has no 'manager' role and User has no managerId), and the rename left the
 * file with duplicate `teamLead` declarations so it could not even parse.
 *
 * Validates: Requirements 3.5, 3.6
 */

jest.mock('@/lib/appwrite', () => ({
  account: {
    create: jest.fn(),
  },
  databases: {
    createDocument: jest.fn(),
    getDocument: jest.fn(),
    updateDocument: jest.fn(),
    deleteDocument: jest.fn(),
    listDocuments: jest.fn(),
  },
  DATABASE_ID: 'test-database',
  invalidateCollectionReads: jest.fn(),
  COLLECTIONS: {
    USERS: 'test-users-collection',
  },
}));

const branchIdArb = fc.stringMatching(/^[a-z0-9]{4,12}$/);

const teamLeadArb = fc.record({
  $id: fc.uuid(),
  name: fc.string({ minLength: 1, maxLength: 128 }),
  email: fc.emailAddress(),
  branchIds: fc.uniqueArray(branchIdArb, { minLength: 1, maxLength: 5 }),
});

/**
 * Wire the Appwrite mock so createDocument echoes back the payload the service
 * actually wrote. The assertions therefore describe what the service persists,
 * not what the test itself constructed.
 */
function mockCreateDocumentEcho(documentId: string) {
  (account.create as jest.Mock).mockResolvedValue({ $id: documentId });
  (databases.createDocument as jest.Mock).mockImplementation(
    async (_dbId: string, _collectionId: string, _id: string, payload: Record<string, unknown>) => ({
      $id: documentId,
      ...payload,
    })
  );
}

describe('Hierarchy Chain Properties', () => {
  describe('Property 6: Hierarchy chain correctness', () => {
    it('a created team lead has role team_lead and no supervisor', async () => {
      await fc.assert(
        fc.asyncProperty(teamLeadArb, async (input) => {
          jest.clearAllMocks();
          mockCreateDocumentEcho(input.$id);

          const teamLead = await createTeamLead({
            name: input.name,
            email: input.email,
            password: 'securePassword123',
            branchIds: input.branchIds,
          });

          expect(teamLead.role).toBe('team_lead');
          expect(teamLead.teamLeadId).toBeNull();
          expect(teamLead.branchIds).toEqual(input.branchIds);
        }),
        { numRuns: 25 }
      );
    });

    it('an agent created under a team lead points back at that team lead', async () => {
      await fc.assert(
        fc.asyncProperty(
          teamLeadArb.chain((teamLead) =>
            fc.record({
              teamLead: fc.constant(teamLead),
              agentBranchIds: fc.subarray(teamLead.branchIds, { minLength: 1 }),
              agentName: fc.string({ minLength: 1, maxLength: 128 }),
              agentEmail: fc.emailAddress(),
            })
          ),
          async ({ teamLead, agentBranchIds, agentName, agentEmail }) => {
            jest.clearAllMocks();
            mockCreateDocumentEcho('agent-doc-id');
            (databases.getDocument as jest.Mock).mockResolvedValue({
              $id: teamLead.$id,
              name: teamLead.name,
              email: teamLead.email,
              role: 'team_lead',
              teamLeadId: null,
              branchIds: teamLead.branchIds,
            });

            const agent = await createAgent({
              name: agentName,
              email: agentEmail,
              password: 'securePassword123',
              teamLeadId: teamLead.$id,
              branchIds: agentBranchIds,
            });

            expect(agent.role).toBe('agent');
            expect(agent.teamLeadId).toBe(teamLead.$id);
            // The chain is complete: the agent's supervisor is the top of the team
            expect(agent.branchIds).toEqual(agentBranchIds);
            expect(
              agent.branchIds.every((branchId) => teamLead.branchIds.includes(branchId))
            ).toBe(true);
          }
        ),
        { numRuns: 25 }
      );
    });

    it('an agent cannot be created in a branch the team lead does not hold', async () => {
      await fc.assert(
        fc.asyncProperty(
          teamLeadArb.chain((teamLead) =>
            fc.record({
              teamLead: fc.constant(teamLead),
              foreignBranchId: branchIdArb.filter(
                (branchId) => !teamLead.branchIds.includes(branchId)
              ),
            })
          ),
          async ({ teamLead, foreignBranchId }) => {
            jest.clearAllMocks();
            mockCreateDocumentEcho('agent-doc-id');
            (databases.getDocument as jest.Mock).mockResolvedValue({
              $id: teamLead.$id,
              name: teamLead.name,
              email: teamLead.email,
              role: 'team_lead',
              teamLeadId: null,
              branchIds: teamLead.branchIds,
            });

            await expect(
              createAgent({
                name: 'Agent',
                email: 'agent@test.com',
                password: 'securePassword123',
                teamLeadId: teamLead.$id,
                branchIds: [foreignBranchId],
              })
            ).rejects.toThrow(`Branch ${foreignBranchId} is not in your assigned branches`);

            expect(databases.createDocument).not.toHaveBeenCalled();
          }
        ),
        { numRuns: 25 }
      );
    });
  });
});
