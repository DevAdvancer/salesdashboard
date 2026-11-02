/** @jest-environment node */
import { NextRequest } from 'next/server';
import { POST } from '@/app/api/public/client-card/route';
import { GET } from '@/app/share/client/route';
import { readPublicClientCard } from '@/lib/server/public-client-card';
import { newCardToken } from '@/lib/server/client-card-security';
import { allowClientCardRead } from '@/lib/server/client-card-rate-limit';
jest.mock('@/lib/server/public-client-card', () => ({ readPublicClientCard: jest.fn() }));
jest.mock('@/lib/server/client-card-rate-limit', () => ({ allowClientCardRead: jest.fn() }));
const token = newCardToken('entry').token;
function request(body: unknown, origin = 'http://localhost:5000', contentType = 'application/json') {
  return new NextRequest('http://localhost:5000/api/public/client-card', { method: 'POST', headers: { origin, 'content-type': contentType }, body: JSON.stringify(body) });
}
beforeEach(() => { jest.clearAllMocks(); (allowClientCardRead as jest.Mock).mockReturnValue(true); });
test('cross-origin, non-JSON, malformed, oversized and caller-selected fields are rejected before DB reads', async () => {
  for (const response of [await POST(request({ token }, 'https://other.example')), await POST(request({ token }, 'http://localhost:5000', 'text/plain')),
    await POST(request({ token: 'bad' })), await POST(request({ token, entryId: 'other-entry' })), await POST(request({ token, limit: 5000 })), await POST(request({ token, x: 'a'.repeat(4000) }))]) expect(response.status).toBeGreaterThanOrEqual(400);
  expect(readPublicClientCard).not.toHaveBeenCalled();
});
test('rate-limited requests cause no database reads', async () => {
  (allowClientCardRead as jest.Mock).mockReturnValue(false);
  const response = await POST(request({ token })); expect(response.status).toBe(429); expect(response.headers.get('Retry-After')).toBe('60');
  expect(readPublicClientCard).not.toHaveBeenCalled();
});
test('public responses cannot be cached, indexed or framed, and errors never echo internal details', async () => {
  (readPublicClientCard as jest.Mock).mockResolvedValue({ card: { candidateName: 'Client' }, feedback: [], nextCursor: null });
  const response = await POST(request({ token })); expect(response.status).toBe(200);
  expect(response.headers.get('Cache-Control')).toContain('no-store'); expect(response.headers.get('Referrer-Policy')).toBe('no-referrer'); expect(response.headers.get('X-Frame-Options')).toBe('DENY');
  (readPublicClientCard as jest.Mock).mockRejectedValue(new Error('PRIVATE DATABASE ERROR AND KEY'));
  const failed = await POST(request({ token })); expect(failed.status).toBe(404); expect(JSON.stringify(await failed.json())).not.toMatch(/PRIVATE|KEY/);
});
test('the standalone public shell has a nonce CSP, no auth providers and text-only content rendering', async () => {
  const response = await GET(); const html = await response.text();
  const csp = response.headers.get('Content-Security-Policy')!;
  expect(csp).toContain("default-src 'none'"); expect(csp).toContain("frame-ancestors 'none'"); expect(csp).not.toContain('unsafe-inline');
  expect(html).not.toMatch(/innerHTML|dangerouslySetInnerHTML|__NEXT_DATA__|Appwrite|AzureMsal/);
  expect(html).toContain('textContent'); expect(html).toContain('location.hash'); expect(html).toContain("credentials:'omit'");
});
