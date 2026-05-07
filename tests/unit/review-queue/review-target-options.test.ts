import {
  buildFormFieldTargetOptions,
  buildLeadTargetOptions,
  buildUserTargetOptions,
  findReviewTargetOption,
} from '@/lib/utils/review-target-options';
import type { FormField, Lead, User } from '@/lib/types';

describe('review target options', () => {
  it('builds searchable labels for lead targets while preserving Appwrite IDs', () => {
    const leads = [
      {
        $id: 'lead_123',
        data: JSON.stringify({
          firstName: 'Mina',
          lastName: 'Patel',
          email: 'mina@example.com',
          phone: '5551234567',
          company: 'Silver Space',
        }),
        status: 'New',
        ownerId: 'owner_1',
        assignedToId: null,
        branchId: 'branch_1',
        isClosed: false,
        closedAt: null,
      },
    ] as Lead[];

    const options = buildLeadTargetOptions(leads, 'LEAD');

    expect(options).toHaveLength(1);
    expect(options[0]).toMatchObject({
      id: 'lead_123',
      type: 'LEAD',
      label: 'Mina Patel',
    });
    expect(options[0].description).toContain('mina@example.com');
    expect(findReviewTargetOption(options, options[0].value)?.id).toBe('lead_123');
  });

  it('builds user and form-field target options for the same selector', () => {
    const users = [
      {
        $id: 'user_123',
        name: 'Alex Teamlead',
        email: 'alex@example.com',
        role: 'team_lead',
        managerId: null,
        teamLeadId: null,
        branchIds: [],
      },
    ] as User[];
    const fields = [
      {
        id: 'field_123',
        key: 'visaStatus',
        label: 'Visa Status',
        type: 'dropdown',
        required: false,
        visible: true,
        order: 1,
      },
    ] as FormField[];

    expect(buildUserTargetOptions(users)[0]).toMatchObject({
      id: 'user_123',
      type: 'USER',
      label: 'Alex Teamlead',
    });
    expect(buildFormFieldTargetOptions(fields)[0]).toMatchObject({
      id: 'field_123',
      type: 'FORM_FIELD',
      label: 'Visa Status',
    });
  });
});
