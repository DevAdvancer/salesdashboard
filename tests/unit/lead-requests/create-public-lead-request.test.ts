jest.mock('next/cache', () => ({
  revalidatePath: jest.fn(),
}));

jest.mock('node-appwrite', () => ({
  ID: {
    unique: jest.fn(() => 'unique-id'),
  },
  Query: {
    orderDesc: jest.fn(),
    orderAsc: jest.fn(),
  },
  Databases: jest.fn(),
}));

import { createPublicLeadRequestAction } from '@/app/actions/lead-requests';
import { createAdminClient } from '@/lib/server/appwrite';
import { listAllDocuments } from '@/lib/server/appwrite-pagination';

jest.mock('@/lib/server/appwrite', () => ({
  createAdminClient: jest.fn(),
}));

jest.mock('@/lib/server/appwrite-pagination', () => ({
  listAllDocuments: jest.fn(),
}));

const mockCreateAdminClient = createAdminClient as jest.MockedFunction<typeof createAdminClient>;
const mockListAllDocuments = listAllDocuments as jest.MockedFunction<typeof listAllDocuments>;

describe('createPublicLeadRequestAction', () => {
  let mockDatabases: any;

  beforeEach(() => {
    jest.clearAllMocks();
    mockDatabases = {
      createDocument: jest.fn().mockResolvedValue({ $id: 'new-request-id' }),
    };
    mockCreateAdminClient.mockResolvedValue({
      databases: mockDatabases,
    } as any);
  });

  it('requires firstName, lastName, email, phone, and linkedinProfileUrl fields', async () => {
    const incompleteInputs = [
      { firstName: '', lastName: 'Doe', email: 'a@b.com', phone: '123', linkedinProfileUrl: 'li.com/in/a' },
      { firstName: 'Jane', lastName: '', email: 'a@b.com', phone: '123', linkedinProfileUrl: 'li.com/in/a' },
      { firstName: 'Jane', lastName: 'Doe', email: '', phone: '123', linkedinProfileUrl: 'li.com/in/a' },
      { firstName: 'Jane', lastName: 'Doe', email: 'a@b.com', phone: '', linkedinProfileUrl: 'li.com/in/a' },
      { firstName: 'Jane', lastName: 'Doe', email: 'a@b.com', phone: '123', linkedinProfileUrl: '' },
    ];

    for (const input of incompleteInputs) {
      await expect(createPublicLeadRequestAction(input)).rejects.toThrow();
    }
  });

  it('rejects duplicate email in pending/moved requests', async () => {
    mockListAllDocuments.mockResolvedValue([
      {
        $id: 'req-1',
        name: 'Existing Lead',
        email: 'test@example.com',
        phone: '111-111-1111',
        linkedinProfileUrl: 'https://linkedin.com/in/test',
        status: 'pending',
      },
    ] as any);

    const input = {
      firstName: 'New',
      lastName: 'Lead',
      email: ' TEST@example.com ',
      phone: '222-222-2222',
      linkedinProfileUrl: 'linkedin.com/in/new',
    };

    await expect(createPublicLeadRequestAction(input)).rejects.toThrow('Email is already there.');
  });

  it('rejects duplicate phone in pending/moved requests', async () => {
    mockListAllDocuments.mockResolvedValue([
      {
        $id: 'req-1',
        name: 'Existing Lead',
        email: 'existing@example.com',
        phone: '+1 555-000-0000',
        linkedinProfileUrl: 'https://linkedin.com/in/test',
        status: 'pending',
      },
    ] as any);

    const input = {
      firstName: 'New',
      lastName: 'Lead',
      email: 'new@example.com',
      phone: '5550000000',
      linkedinProfileUrl: 'linkedin.com/in/new',
    };

    await expect(createPublicLeadRequestAction(input)).rejects.toThrow('Phone is already there.');
  });

  it('rejects duplicate LinkedIn profile link in pending/moved requests', async () => {
    mockListAllDocuments.mockResolvedValue([
      {
        $id: 'req-1',
        name: 'Existing Lead',
        email: 'existing@example.com',
        phone: '111-111-1111',
        linkedinProfileUrl: 'https://linkedin.com/in/existing-user',
        status: 'moved',
      },
    ] as any);

    const input = {
      firstName: 'New',
      lastName: 'Lead',
      email: 'new@example.com',
      phone: '222-222-2222',
      linkedinProfileUrl: 'linkedin.com/in/existing-user/',
    };

    await expect(createPublicLeadRequestAction(input)).rejects.toThrow('LinkedIn link is already there.');
  });

  it('allows submissions when there are no duplicates', async () => {
    mockListAllDocuments.mockResolvedValue([
      {
        $id: 'req-1',
        name: 'Existing Lead',
        email: 'existing@example.com',
        phone: '111-111-1111',
        linkedinProfileUrl: 'https://linkedin.com/in/existing-user',
        status: 'pending',
      },
    ] as any);

    const input = {
      firstName: 'New',
      lastName: 'Lead',
      email: 'new@example.com',
      phone: '222-222-2222',
      linkedinProfileUrl: 'linkedin.com/in/new-user',
    };

    const result = await createPublicLeadRequestAction(input);
    expect(result).toEqual({ requestId: 'new-request-id' });
    expect(mockDatabases.createDocument).toHaveBeenCalled();
  });
});
