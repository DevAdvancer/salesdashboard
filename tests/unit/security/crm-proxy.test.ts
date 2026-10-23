import { proxy } from '@/proxy';
import { assertCrmAccessForProxy as assertCrmAccess, crmAccessEnabled, CrmAccessError } from '@/lib/server/crm-access';
import type { NextRequest } from 'next/server';
const mockNext = jest.fn((init?: { request?: { headers?: Headers } }) => { void init; return { allowed: true }; });
jest.mock('@/lib/server/crm-access', () => ({ assertCrmAccessForProxy: jest.fn(), crmAccessEnabled: jest.fn(),
  CRM_ACCESS_PASS_HEADER: 'x-crm-access-pass',
  CrmAccessError: class extends Error { constructor(public status: number, message: string, public code: string) { super(message); } },
}));
jest.mock('next/server', () => ({ NextResponse: {
  next: (init?: { request?: { headers?: Headers } }) => mockNext(init), json: (body: unknown, options: unknown) => ({ body, options }),
  redirect: (url: URL) => ({ redirect: url.toString() }),
} }));
function request(path: string, method = 'POST', action = false, extra: Record<string, string> = {}) {
  const headers = new Headers(extra);
  if (action) headers.set('next-action', 'action-id');
  return { url: `http://localhost:5000${path}`, nextUrl: new URL(`http://localhost:5000${path}`), method,
    headers, cookies: {} } as unknown as NextRequest;
}
const forwardedHeaders = () => (mockNext.mock.calls.at(-1)?.[0]?.request?.headers) as Headers;
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
it('forwards a fresh signed pass to the handler of an approved request', async () => {
  (assertCrmAccess as jest.Mock).mockResolvedValue('signed-pass');
  expect(await proxy(request('/api/leads/list', 'GET', false, { 'x-crm-access-pass': 'forged' }))).toEqual({ allowed: true });
  expect(forwardedHeaders().get('x-crm-access-pass')).toBe('signed-pass');
});
it('strips a browser-supplied pass on public and bypassed paths', async () => {
  for (const path of ['/login', '/api/security/access', '/api/cron/security-cleanup']) {
    await proxy(request(path, 'GET', false, { 'x-crm-access-pass': 'forged' }));
    expect(forwardedHeaders().get('x-crm-access-pass')).toBeNull();
  }
  (crmAccessEnabled as jest.Mock).mockReturnValue(false);
  await proxy(request('/api/leads/list', 'GET', false, { 'x-crm-access-pass': 'forged' }));
  expect(forwardedHeaders().get('x-crm-access-pass')).toBeNull();
});
