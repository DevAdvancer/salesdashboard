import type { Databases } from 'node-appwrite';
import { withdrawLeadRequests } from '@/lib/server/lead-request-release';
import { COLLECTIONS, DATABASE_ID } from '@/lib/constants/appwrite';
import type { Lead } from '@/lib/types';
jest.mock('node-appwrite', () => ({ Query: { equal: jest.fn(), orderAsc: jest.fn(), limit: jest.fn() } }));

const url = 'https://linkedin.com/in/person';
const lead = { $id: 'lead', data: JSON.stringify({ linkedinProfileUrl: url, linkedinRequestId: 'legacy' }) } as Lead;

it('withdraws all linked requests plus the legacy reference while retaining historical links and acceptance dates', async () => {
  const raw = {
    listDocuments: jest.fn().mockResolvedValue({ documents: [
      { $id: 'linked', leadId: 'lead', targetUrl: url, status: 'accepted', acceptedAt: 'before' },
      { $id: 'withdrawn', leadId: 'lead', targetUrl: url, status: 'withdrawn' },
    ] }),
    getDocument: jest.fn().mockResolvedValue({ $id: 'legacy', targetUrl: url, status: 'sent', leadId: null }),
    updateDocument: jest.fn().mockResolvedValue({}),
  };
  await withdrawLeadRequests(raw as unknown as Databases, lead, 'now');
  expect(raw.updateDocument.mock.calls).toEqual(['linked', 'legacy'].map(id => [DATABASE_ID,
    COLLECTIONS.LINKEDIN_REQUESTS, id, { status: 'withdrawn', isActive: false, withdrawnAt: 'now' }]));
});

it('propagates lookup failures before a released lead can be reused', async () => {
  const raw = { listDocuments: jest.fn().mockRejectedValue(new Error('offline')), updateDocument: jest.fn() };
  await expect(withdrawLeadRequests(raw as unknown as Databases, lead, 'now')).rejects.toThrow('offline');
  expect(raw.updateDocument).not.toHaveBeenCalled();
});

it('ignores a stale legacy reference that now belongs to another lead', async () => {
  const raw = { listDocuments: jest.fn().mockResolvedValue({ documents: [] }),
    getDocument: jest.fn().mockResolvedValue({ $id: 'legacy', targetUrl: url, leadId: 'other', status: 'accepted' }),
    updateDocument: jest.fn() };
  await withdrawLeadRequests(raw as unknown as Databases, lead, 'now');
  expect(raw.updateDocument).not.toHaveBeenCalled();
});

it('keeps a newly accepted resend active when the request row was reused', async () => {
  const raw = { listDocuments: jest.fn().mockResolvedValue({ documents: [] }),
    getDocument: jest.fn().mockResolvedValue({ $id: 'legacy', targetUrl: url, leadId: null, status: 'accepted' }),
    updateDocument: jest.fn() };
  await withdrawLeadRequests(raw as unknown as Databases, lead, 'now', 'legacy');
  expect(raw.updateDocument).not.toHaveBeenCalled();
});
