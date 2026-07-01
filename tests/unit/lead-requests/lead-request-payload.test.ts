jest.mock('@/lib/server/appwrite', () => ({
  createAdminClient: jest.fn(() => Promise.resolve({ databases: {} })),
}));

import {
  buildLeadRequestLeadData,
  findLeadRequestDuplicateWarnings,
  normalizePublicLeadRequestInput,
} from '@/lib/utils/lead-requests';
import type { Lead } from '@/lib/types';

const mockDatabases = {
  getDocument: jest.fn(() => Promise.reject(new Error('not found'))),
};

const mockCreateAdminClient = require('@/lib/server/appwrite').createAdminClient as jest.MockedFunction<typeof jest.fn>;
mockCreateAdminClient.mockResolvedValue({ databases: mockDatabases });

describe('lead request payload helpers', () => {
  it('normalizes public referral fields and builds lead data JSON-compatible payload', () => {
    const input = normalizePublicLeadRequestInput({
      name: '  Jane Doe  ',
      email: ' JANE@EXAMPLE.COM ',
      phone: ' +1 (555) 111-2222 ',
      linkedinProfileUrl: ' linkedin.com/in/jane-doe/ ',
      city: ' Dallas ',
      interestedService: ' Staffing ',
      referrerName: '  Amit  ',
      notes: ' Wants a callback ',
    });

    expect(input).toEqual({
      firstName: 'Jane Doe',
      lastName: '',
      name: 'Jane Doe',
      email: 'jane@example.com',
      phone: '+1 (555) 111-2222',
      linkedinProfileUrl: 'https://linkedin.com/in/jane-doe',
      city: 'Dallas',
      interestedService: 'Staffing',
      referrerName: 'Amit',
      notes: 'Wants a callback',
      referrerCompany: '',
      bonusAmount: '',
      paymentDate: '',
      paymentMode: '',
      salesPerson: '',
    });

    expect(buildLeadRequestLeadData(input, 'request-1')).toEqual({
      firstName: 'Jane Doe',
      lastName: '',
      email: 'jane@example.com',
      phone: '+1 (555) 111-2222',
      linkedinProfileUrl: 'https://linkedin.com/in/jane-doe',
      city: 'Dallas',
      interestedService: 'Staffing',
      referrerName: 'Amit',
      notes: 'Wants a callback',
      source: 'Referral Form',
      sourceName: 'Referral Form',
      leadRequestId: 'request-1',
    });

    // Test with explicit first name and last name
    const splitInput = normalizePublicLeadRequestInput({
      firstName: ' Jane ',
      lastName: ' Doe ',
      email: 'jane@example.com',
      phone: '5551112222',
    });

    expect(splitInput.firstName).toBe('Jane');
    expect(splitInput.lastName).toBe('Doe');
    expect(splitInput.name).toBe('Jane Doe');

    // Test with Reference Bonus fields
    const bonusInput = normalizePublicLeadRequestInput({
      firstName: 'Jane',
      lastName: 'Doe',
      email: 'jane@example.com',
      phone: '5551112222',
      referrerCompany: ' SST ',
      bonusAmount: ' $500 ',
      paymentDate: ' NA ',
      paymentMode: ' Stripe ',
      salesPerson: ' Dhananjay Patil ',
    });

    expect(bonusInput.referrerCompany).toBe('SST');
    expect(bonusInput.bonusAmount).toBe('$500');
    expect(bonusInput.paymentDate).toBe('NA');
    expect(bonusInput.paymentMode).toBe('Stripe');
    expect(bonusInput.salesPerson).toBe('Dhananjay Patil');

    const bonusLeadData = buildLeadRequestLeadData(bonusInput, 'request-2');
    expect(bonusLeadData.referrerCompany).toBe('SST');
    expect(bonusLeadData.bonusAmount).toBe('$500');
    expect(bonusLeadData.paymentDate).toBe('NA');
    expect(bonusLeadData.paymentMode).toBe('Stripe');
    expect(bonusLeadData.salesPerson).toBe('Dhananjay Patil');
  });

  it('flags duplicate email, phone, and linkedin values against existing leads', async () => {
    const leads = [
      lead('lead-email', { email: 'jane@example.com' }),
      lead('lead-phone', { phone: '5551112222' }),
      lead('lead-linkedin', { linkedinProfile: 'https://www.linkedin.com/in/jane-doe/' }),
    ];

    const result = await findLeadRequestDuplicateWarnings(
      {
        email: 'JANE@example.com',
        phone: '+1 (555) 111-2222',
        linkedinProfileUrl: 'linkedin.com/in/jane-doe',
      },
      leads,
    );
    // Owner/assigned names are populated by the server via Appwrite;
    // in unit tests they resolve to undefined because there is no DB.
    expect(result).toEqual([
      { field: 'email', existingLeadId: 'lead-email', existingBranchId: undefined, existingLeadOwnerName: undefined, existingLeadAssignedToName: undefined },
      { field: 'phone', existingLeadId: 'lead-phone', existingBranchId: undefined, existingLeadOwnerName: undefined, existingLeadAssignedToName: undefined },
      { field: 'linkedinProfileUrl', existingLeadId: 'lead-linkedin', existingBranchId: undefined, existingLeadOwnerName: undefined, existingLeadAssignedToName: undefined },
    ]);
  });
});

function lead($id: string, data: Record<string, unknown>): Lead {
  return {
    $id,
    data: JSON.stringify(data),
    status: 'Interested',
    ownerId: 'admin-1',
    assignedToId: null,
    branchId: null,
    isClosed: false,
    closedAt: null,
  };
}
