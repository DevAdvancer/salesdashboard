import { indexedProfileCandidates, LEAD_PROFILE_CHECKPOINT, ProfileReadBudgetError } from '@/lib/server/lead-profile-index';
import { findProtectedLinkedinLead } from '@/lib/server/linkedin-lead-protection';
import { COLLECTIONS } from '@/lib/constants/appwrite';
import type { Databases } from 'node-appwrite';
jest.mock('node-appwrite', () => ({ Query: Object.fromEntries(['equal', 'greaterThanEqual', 'select', 'orderAsc', 'limit', 'or'].map(method =>
  [method, (...args: unknown[]) => JSON.stringify({ method, args })])) }));
it('bounds an oversized query and stops repeated reads for one minute', async () => {
  const db = { getDocument: jest.fn(async () => ({ kind: LEAD_PROFILE_CHECKPOINT, leadId: 'ready', profileUrl: '2026-10-22T00:00:00Z' })),
    listDocuments: jest.fn(async (_database, collection) => collection === COLLECTIONS.LEADS
      ? { total: 40000, documents: Array.from({ length: 101 }, (_, i) => ({ $id: String(i) })) }
      : { total: 0, documents: [] }) } as unknown as Databases;
  await expect(indexedProfileCandidates(db, 'https://linkedin.com/in/person')).rejects.toBeInstanceOf(ProfileReadBudgetError);
  expect((db.listDocuments as jest.Mock).mock.calls[1][2]).toContain(JSON.stringify({ method: 'limit', args: [101] }));
  const reads = (db.listDocuments as jest.Mock).mock.calls.length;
  await expect(indexedProfileCandidates(db, 'https://linkedin.com/in/another')).rejects.toBeInstanceOf(ProfileReadBudgetError);
  expect(db.listDocuments).toHaveBeenCalledTimes(reads);
});
it('never starts a production full scan when the index is missing', async () => {
  const replacement = jest.replaceProperty(process, 'env', { ...process.env, NODE_ENV: 'production', CRM_ALLOW_FULL_PROFILE_SCAN: 'false', APPWRITE_API_KEY: 'production-budget-test' });
  try {
    expect(Reflect.get(process.env, 'NODE_ENV')).toBe('production');
    const db = { getDocument: jest.fn().mockRejectedValue({ code: 404 }), listDocuments: jest.fn() } as unknown as Databases;
    await expect(findProtectedLinkedinLead(db, 'https://linkedin.com/in/unknown')).rejects.toThrow('refresh the profile index');
    expect(db.listDocuments).not.toHaveBeenCalled();
  } finally {
    replacement.restore();
  }
});
