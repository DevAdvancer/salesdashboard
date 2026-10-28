/** @jest-environment node */
import { NextRequest } from 'next/server';
import { GET } from '@/app/api/cron/refresh-lead-profile-index/route';
const mockGet = jest.fn();
const mockApply = jest.fn();
const mockPlan = jest.fn();
jest.mock('@/lib/server/crm-access', () => ({ securityDatabase: () => ({ getDocument: mockGet }) }));
jest.mock('@/lib/server/lead-profile-index-maintenance', () => ({ profileIndexPlan: (...args: unknown[]) => mockPlan(...args) }));
const previousSecret = process.env.CRON_SECRET;
beforeEach(() => {
  jest.clearAllMocks(); process.env.CRON_SECRET = 'test-secret';
  mockGet.mockResolvedValue({ leadId: 'ready' });
  mockPlan.mockResolvedValue({ scanned: 1, apply: mockApply });
  mockApply.mockResolvedValue({ indexRecordsWritten: 0 });
});
afterEach(() => { if (previousSecret === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = previousSecret; });
it('does not read or mutate metadata without the cron secret', async () => {
  expect((await GET(new NextRequest('http://localhost/api/cron/refresh-lead-profile-index'))).status).toBe(401);
  expect(mockGet).not.toHaveBeenCalled(); expect(mockApply).not.toHaveBeenCalled();
});
it('skips safely until the index is provisioned', async () => {
  mockGet.mockRejectedValueOnce({ code: 404 });
  const result = await GET(new NextRequest('http://localhost/api/cron/refresh-lead-profile-index', { headers: { authorization: 'Bearer test-secret' } }));
  expect(result.status).toBe(200); expect(mockApply).not.toHaveBeenCalled();
});
it('runs the verified maintenance operation after authenticating the scheduler', async () => {
  const result = await GET(new NextRequest('http://localhost/api/cron/refresh-lead-profile-index', { headers: { authorization: 'Bearer test-secret' } }));
  expect(result.status).toBe(200); expect(mockApply).toHaveBeenCalledTimes(1);
});
it('does not reactivate an index that an administrator deliberately disabled', async () => {
  mockGet.mockResolvedValueOnce({ leadId: 'disabled' });
  const result = await GET(new NextRequest('http://localhost/api/cron/refresh-lead-profile-index', { headers: { authorization: 'Bearer test-secret' } }));
  expect(result.status).toBe(200); expect(mockPlan).not.toHaveBeenCalled();
});
it('skips the locked refresh when no lead changed since the checkpoint', async () => {
  mockPlan.mockResolvedValueOnce({ scanned: 0, apply: mockApply });
  const result = await GET(new NextRequest('http://localhost/api/cron/refresh-lead-profile-index', { headers: { authorization: 'Bearer test-secret' } }));
  expect(result.status).toBe(200); expect(mockApply).not.toHaveBeenCalled();
});
