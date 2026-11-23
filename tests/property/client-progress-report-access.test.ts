/** @jest-environment node */
import fc from 'fast-check';
import { POST } from '@/app/api/client-progress/report/route';
import { PROGRESS_ROLES } from '@/lib/client-progress';
import { createAdminClient } from '@/lib/server/appwrite';
import { getAuthenticatedUserDoc } from '@/lib/server/current-user';

jest.mock('@/lib/server/appwrite', () => ({ createAdminClient: jest.fn() }));
jest.mock('@/lib/server/crm-access', () => ({ crmAccessEnabled: () => true }));
jest.mock('@/lib/server/current-user', () => ({ getAuthenticatedUserDoc: jest.fn() }));

const range = { from: '2026-11-01', to: '2026-11-07' };
const listDocuments = jest.fn(async () => ({ documents: [] }));
const views = [
  { view: 'summary', range },
  { view: 'person', range, authorId: 'author' },
  { view: 'feedback', range, authorId: 'author', entryId: 'client' },
  { view: 'export', range, authorId: 'author' },
];

function reportRequest(body: unknown) {
  return new Request('http://localhost/api/client-progress/report', { method: 'POST', body: JSON.stringify(body) });
}

test('every report read requires an active Sales Admin', async () => {
  jest.mocked(createAdminClient).mockResolvedValue({ databases: { uncachedReads: { listDocuments } } } as unknown as Awaited<ReturnType<typeof createAdminClient>>);
  await fc.assert(fc.asyncProperty(
    fc.constantFrom(...PROGRESS_ROLES), fc.constantFrom('sales', 'resume', undefined), fc.boolean(), fc.constantFrom(...views),
    async (role, department, isActive, view) => {
      listDocuments.mockClear();
      jest.mocked(getAuthenticatedUserDoc).mockResolvedValue({ $id: 'actor', role, department, isActive } as Awaited<ReturnType<typeof getAuthenticatedUserDoc>>);
      const response = await POST(reportRequest(view));
      const allowed = role === 'admin' && department !== 'resume' && isActive;
      expect(response.status).toBe(allowed ? 200 : 403);
      await response.text();
      if (!allowed) expect(listDocuments).not.toHaveBeenCalled();
    },
  ));
});

test('a closed CSV download settles cleanly while a data page is being read', async () => {
  let finish!: (result: { documents: [] }) => void;
  let start!: () => void;
  const started = new Promise<void>(resolve => { start = resolve; });
  const listDocuments = jest.fn(() => {
    start();
    return new Promise<{ documents: [] }>(resolve => { finish = resolve; });
  });
  jest.mocked(createAdminClient).mockResolvedValue({ databases: { uncachedReads: { listDocuments } } } as unknown as Awaited<ReturnType<typeof createAdminClient>>);
  jest.mocked(getAuthenticatedUserDoc).mockResolvedValue({ $id: 'admin', role: 'admin', department: 'sales', isActive: true } as Awaited<ReturnType<typeof getAuthenticatedUserDoc>>);
  const response = await POST(reportRequest({ view: 'export', range }));
  const reader = response.body!.getReader();
  const header = await reader.read();
  expect(new TextDecoder().decode(header.value)).toContain('Posted at (Eastern)');
  const nextPage = reader.read();
  await started;
  const closing = reader.cancel();
  finish({ documents: [] });
  await expect(closing).resolves.toBeUndefined();
  await expect(nextPage).resolves.toEqual({ done: true, value: undefined });
});
