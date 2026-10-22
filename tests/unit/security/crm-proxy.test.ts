import { proxy } from '@/proxy';
import { assertCrmAccess, crmAccessEnabled, CrmAccessError } from '@/lib/server/crm-access';
import type { NextRequest } from 'next/server';
jest.mock('@/lib/server/crm-access', () => ({ assertCrmAccess: jest.fn(), crmAccessEnabled: jest.fn(),
  CrmAccessError: class extends Error { constructor(public status: number, message: string, public code: string) { super(message); } },
}));
jest.mock('next/server', () => ({ NextResponse: {
  next: () => ({ allowed: true }), json: (body: unknown, options: unknown) => ({ body, options }),
  redirect: (url: URL) => ({ redirect: url.toString() }),
} }));
function request(path: string, method = 'POST', action = false) {
  return { url: `http://localhost:5000${path}`, nextUrl: new URL(`http://localhost:5000${path}`), method,
    headers: { has: () => action }, cookies: {} } as unknown as NextRequest;
}
beforeEach(() => { jest.clearAllMocks(); (crmAccessEnabled as jest.Mock).mockReturnValue(true); });
it.each(['/api/assessment/send-email', '/api/interview/send-email', '/api/mock/send-email', '/api/leads/list'])(
  'denies direct calls to %s while attendance is blocked', async path => {
    (assertCrmAccess as jest.Mock).mockRejectedValue(new CrmAccessError(403, 'Attendance approval required', 'attendance_required'));
    expect(await proxy(request(path))).toMatchObject({ options: { status: 403 }, body: { code: 'attendance_required' } });
  },
);
it('does not bypass OTP for a server action posted to the public login page', async () => {
  (assertCrmAccess as jest.Mock).mockRejectedValue(new CrmAccessError(403, 'Verify your email', 'otp_required'));
  expect(await proxy(request('/login', 'POST', true))).toMatchObject({ options: { status: 403 } });
});
it('fails closed when access checks fail unexpectedly', async () => {
  (assertCrmAccess as jest.Mock).mockRejectedValue(new Error('backend unavailable'));
  expect(await proxy(request('/api/mock/send-email'))).toMatchObject({ options: { status: 503 } });
});
it('keeps the sign-in, verification and session-sync endpoints reachable without approving CRM access', async () => {
  expect(await proxy(request('/login', 'GET'))).toEqual({ allowed: true });
  expect(await proxy(request('/api/security/access'))).toEqual({ allowed: true });
  expect(await proxy(request('/api/auth/appwrite-session'))).toEqual({ allowed: true });
  expect(assertCrmAccess).not.toHaveBeenCalled();
});
