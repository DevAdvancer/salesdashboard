/** @jest-environment node */
import { saveTargetMonthBound, getReportingCalendarAction } from '@/app/actions/target-month-bounds';
import { getAuthenticatedUserDoc } from '@/lib/server/current-user';
import { readReportingWindowsFresh, readReportingWindows, invalidateReportingCalendar } from '@/lib/server/reporting-calendar';
import { createAdminClient } from '@/lib/server/appwrite';
jest.mock('@/lib/server/current-user', () => ({ getAuthenticatedUserDoc: jest.fn() }));
jest.mock('@/lib/server/appwrite', () => ({ createAdminClient: jest.fn() }));
jest.mock('@/lib/server/reporting-calendar', () => ({ readReportingWindowsFresh: jest.fn(), readReportingWindows: jest.fn(), readTargetMonthBound: jest.fn(), invalidateReportingCalendar: jest.fn() }));
const windows = [{ $id: 'october', monthKey: '2026-10', leadsFromIso: '2026-10-02', leadsToIso: '2026-11-02' }, { $id: 'november', monthKey: '2026-11', leadsFromIso: '2026-11-03', leadsToIso: '2026-11-30' }];
const db = { createDocument: jest.fn(), updateDocument: jest.fn() };
beforeEach(() => {
  jest.clearAllMocks();
  (getAuthenticatedUserDoc as jest.Mock).mockResolvedValue({ $id: 'admin', role: 'admin' });
  (createAdminClient as jest.Mock).mockResolvedValue({ databases: db });
  (readReportingWindowsFresh as jest.Mock).mockResolvedValue(windows);
  (readReportingWindows as jest.Mock).mockResolvedValue(windows);
});
test('non-admin writes are denied before a settings read or mutation', async () => {
  (getAuthenticatedUserDoc as jest.Mock).mockResolvedValue({ $id: 'agent', role: 'agent' });
  await expect(saveTargetMonthBound('2026-10', '2026-10-02', '2026-11-02')).rejects.toThrow('Unauthorized');
  expect(readReportingWindowsFresh).not.toHaveBeenCalled(); expect(db.updateDocument).not.toHaveBeenCalled();
});
test('overlaps and reversed dates cannot be saved', async () => {
  await expect(saveTargetMonthBound('2026-10', '2026-10-02', '2026-11-03')).resolves.toMatchObject({ ok: false, error: expect.stringContaining('overlaps') });
  await expect(saveTargetMonthBound('2026-10', '2026-11-03', '2026-11-02')).resolves.toMatchObject({ ok: false });
  expect(db.updateDocument).not.toHaveBeenCalled(); expect(db.createDocument).not.toHaveBeenCalled(); expect(invalidateReportingCalendar).not.toHaveBeenCalled();
});
test('an authorized save updates its existing setting and invalidates the shared calendar', async () => {
  await expect(saveTargetMonthBound('2026-10', '2026-10-02', '2026-11-02')).resolves.toEqual({ ok: true });
  expect(db.updateDocument).toHaveBeenCalledWith(expect.any(String), expect.any(String), 'october', { leadsFromIso: '2026-10-02', leadsToIso: '2026-11-02' });
  expect(invalidateReportingCalendar).toHaveBeenCalledTimes(1);
});
test('settings reads still require the authenticated CRM identity', async () => {
  (getAuthenticatedUserDoc as jest.Mock).mockRejectedValue(new Error('Unauthorized'));
  await expect(getReportingCalendarAction()).rejects.toThrow('Unauthorized');
  expect(readReportingWindows).not.toHaveBeenCalled();
});
