import { NextRequest, NextResponse } from 'next/server';
import { cardRequestSchema } from '@/lib/server/client-card-security';
import { readPublicClientCard } from '@/lib/server/public-client-card';
import { allowClientCardRead } from '@/lib/server/client-card-rate-limit';

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store, max-age=0', 'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex, nofollow, noarchive, nosnippet', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY' };
async function smallBody(request: NextRequest) {
  if (Number(request.headers.get('content-length') || '0') > 2048) return null;
  const reader = request.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > 2048) { await reader.cancel(); return null; }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch { return null; }
  finally { reader.releaseLock(); }
}
/** Possession-based read only. No CRM cookies, caller-selected IDs, writes or public Appwrite grants. */
export async function POST(request: NextRequest) {
  if (request.headers.get('origin') !== request.nextUrl.origin ||
    !/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') || '')) {
    return NextResponse.json({ error: 'Card unavailable.' }, { status: 403, headers });
  }
  const parsed = cardRequestSchema.safeParse(await smallBody(request));
  if (!parsed.success) return NextResponse.json({ error: 'Card unavailable.' }, { status: 400, headers });
  // Only Vercel's platform-set address headers are trusted. Other deployments share a conservative bucket.
  const ip = process.env.VERCEL === '1' ? request.headers.get('x-vercel-forwarded-for') || request.headers.get('x-real-ip') || 'unknown' : 'public';
  if (!allowClientCardRead(ip, parsed.data.token.split('.')[0])) return NextResponse.json({ error: 'Please wait a minute before opening more feedback.' }, { status: 429, headers: { ...headers, 'Retry-After': '60' } });
  try { return NextResponse.json(await readPublicClientCard(parsed.data), { headers }); }
  catch {
    // Invalid, expired, revoked, changed-subject and ineligible-client links look identical.
    return NextResponse.json({ error: 'This card is unavailable. Ask the sender for a current link.' }, { status: 404, headers });
  }
}
