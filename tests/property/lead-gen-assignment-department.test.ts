jest.mock('@/lib/server/appwrite', () => ({ createAdminClient: jest.fn() }));
jest.mock('@/lib/server/current-user', () => ({ assertAuthenticatedUserId: jest.fn() }));
jest.mock('@/lib/server/notifications', () => ({ createNotificationsForRecipients: jest.fn() }));
jest.mock('@/app/actions/lg-handoffs', () => ({ recordLgHandoffAction: jest.fn() }));
jest.mock('node-appwrite', () => ({ Query: { equal: jest.fn(), limit: jest.fn() }, Permission: {}, Role: {}, ID: {} }));

import fc from 'fast-check';
import { assertAssignmentAllowed } from '@/lib/actions/lead/visibility';
import { listLeadAssignableAgentsAction } from '@/lib/actions/lead/assignment';
import { createAdminClient } from '@/lib/server/appwrite';
import { COLLECTIONS } from '@/lib/constants/appwrite';
import { VALID_ROLES, type User, type Lead } from '@/lib/types';

const actor = { $id: 'lg', role: 'lead_generation', department: 'sales' } as User;
const lead = { $id: 'lead', ownerId: actor.$id } as Lead;
const databases = { getDocument: jest.fn(), listDocuments: jest.fn() };

it('permits Lead Gen handoffs only to active Sales team leads for owned leads', async () => {
  await fc.assert(fc.asyncProperty(fc.constantFrom(...VALID_ROLES), fc.constantFrom('sales', 'resume', undefined),
    fc.boolean(), fc.boolean(), async (role, department, isActive, owns) => {
      const assignee = { role, department, isActive } as User;
      const check = assertAssignmentAllowed(actor, assignee, { ...lead, ownerId: owns ? actor.$id : 'other' }, databases as never);
      if (owns && role === 'team_lead' && department !== 'resume' && isActive) await expect(check).resolves.toBeUndefined();
      else await expect(check).rejects.toThrow();
    }));
});

it('returns only active Sales team leads and preserves the department in dropdown data', async () => {
  (createAdminClient as jest.Mock).mockResolvedValue({ databases });
  databases.getDocument.mockImplementation(async (_db, collection) => collection === COLLECTIONS.USERS ? actor : lead);
  await fc.assert(fc.asyncProperty(fc.array(fc.record({ role: fc.constantFrom(...VALID_ROLES),
    department: fc.constantFrom('sales', 'resume', undefined), isActive: fc.boolean() }), { maxLength: 40 }), async entries => {
      databases.listDocuments.mockResolvedValue({ documents: entries.map((entry, i) => ({ ...entry, $id: `u${i}` })) });
      const result = await listLeadAssignableAgentsAction(lead.$id, actor.$id);
      expect(result.map(user => user.$id)).toEqual(entries.flatMap((entry, i) =>
        entry.role === 'team_lead' && entry.department !== 'resume' && entry.isActive ? [`u${i}`] : []));
      for (const user of result) expect(user.department).toBe('sales');
    }));
});
