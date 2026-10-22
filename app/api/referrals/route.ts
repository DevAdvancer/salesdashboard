import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createPublicLeadRequestAction } from '@/app/actions/lead-requests';
import type { PublicLeadRequestInput } from '@/lib/utils/lead-requests';

const fields = ['firstName', 'lastName', 'phone', 'email', 'linkedinProfileUrl', 'city', 'interestedService', 'referrerName', 'notes',
  'referrerCompany', 'bonusAmount', 'paymentDate', 'paymentMode', 'salesPerson'];
const schema = z.object(Object.fromEntries(fields.map(key => [key, z.string().max(5000)]))).strict();
export async function POST(request: NextRequest) {
  if (request.headers.get('origin') !== request.nextUrl.origin || !request.headers.get('content-type')?.startsWith('application/json')) {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 403 });
  }
  try {
    const raw = await request.text();
    if (raw.length > 20_000) return NextResponse.json({ error: 'Request too large.' }, { status: 413 });
    const parsed = schema.safeParse(JSON.parse(raw));
    if (!parsed.success) return NextResponse.json({ error: 'Invalid referral details.' }, { status: 400 });
    return NextResponse.json(await createPublicLeadRequestAction(parsed.data as unknown as PublicLeadRequestInput), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    const expected = ['First name is required.', 'Last name is required.', 'Email is required.', 'Phone is required.', 'LinkedIn link is required.', 'Email is already there.', 'Phone is already there.', 'LinkedIn link is already there.'];
    return NextResponse.json({ error: expected.includes(message) ? message : 'The referral could not be submitted. Please retry.' }, { status: 400 });
  }
}
