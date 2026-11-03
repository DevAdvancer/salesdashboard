/** @jest-environment node */
import { NextRequest } from 'next/server';
import { GET } from '@/app/api/cron/daily-report-summary/route';
import config from '@/vercel.json';

const mockAdmin = jest.fn();
const mockHolidays = jest.fn();
const mockSend = jest.fn();
jest.mock('@/lib/server/appwrite', () => ({ createAdminClient: () => mockAdmin() }));
jest.mock('@/lib/server/holiday-calendar', () => ({ listHolidayDateKeys: () => mockHolidays() }));
jest.mock('@/lib/server/email-service', () => ({ sendNotificationEmail: (...args: unknown[]) => mockSend(...args) }));
jest.mock('@/lib/server/report-email-settings', () => ({ getReportEmails: async () => ['reports@example.com'] }));
jest.mock('@/lib/server/appwrite-pagination', () => ({ listAllDocuments: async () => [] }));

const originalSecret = process.env.CRON_SECRET;
beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  process.env.CRON_SECRET = 'test-cron-secret';
  mockAdmin.mockResolvedValue({ databases: {} });
  mockHolidays.mockResolvedValue([]);
});
afterEach(() => {
  jest.useRealTimers();
  if (originalSecret === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = originalSecret;
});

function request(authorized = true) {
  return new NextRequest('https://crm.example.com/api/cron/daily-report-summary', {
    headers: authorized ? { authorization: 'Bearer test-cron-secret' } : {},
  });
}

test('schedules both possible UTC hours on weekdays', () => {
  expect(config.crons.find(cron => cron.path === '/api/cron/daily-report-summary')?.schedule)
    .toBe('0 21,22 * * 1-5');
});

test.each([
  ['2026-03-06', 22], // Before spring forward: EST
  ['2026-03-09', 21], // After spring forward: EDT
  ['2026-10-30', 21], // Before fall back: EDT
  ['2026-11-02', 22], // After fall back: EST
])('sends once at 5 PM Eastern across both UTC invocations on %s', async (day, sendHour) => {
  for (const hour of [21, 22]) {
    jest.setSystemTime(new Date(`${day}T${hour}:00:00Z`));
    const result = await (await GET(request())).json();
    if (hour === sendHour) expect(result).toEqual({ ok: true, sentTo: 1 });
    else expect(result).toEqual({ ok: true, skipped: true, reason: 'Not 5 PM Eastern' });
  }
  expect(mockAdmin).toHaveBeenCalledTimes(1);
  expect(mockSend).toHaveBeenCalledTimes(1);
  expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({ subject: `Daily Report Summary - ${day}` }));
});

test('still requires cron authorization', async () => {
  jest.setSystemTime(new Date('2026-11-03T22:00:00Z'));
  expect((await GET(request(false))).status).toBe(401);
  expect(mockAdmin).not.toHaveBeenCalled();
  expect(mockSend).not.toHaveBeenCalled();
});

test.each(['2026-11-07', '2026-11-08', '2026-11-03'])('skips weekends and configured holidays on %s', async day => {
  jest.setSystemTime(new Date(`${day}T22:00:00Z`));
  mockHolidays.mockResolvedValue([day]);
  expect(await (await GET(request())).json()).toEqual({ ok: true, skipped: true, reason: 'Not a working day' });
  expect(mockSend).not.toHaveBeenCalled();
});
