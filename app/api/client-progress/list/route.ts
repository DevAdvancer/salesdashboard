import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { listClientProgressAction } from '@/app/actions/client-progress';
import { withCrmRequestContext } from '@/lib/server/crm-request-context';

const inputSchema = z.object({ filters: z.unknown().optional() }).strict();
const headers = { 'Cache-Control': 'private, no-store' };

/** Read-only POST: submitted names stay out of URLs and browser history. */
export async function POST(request: NextRequest) {
  return withCrmRequestContext(async () => {
    const input = inputSchema.safeParse(await request.json().catch(() => null));
    if (!input.success) return NextResponse.json({ error: 'Invalid filters.' }, { status: 400, headers });
    // The owning action derives identity/scope from the session; no client actor/role is accepted.
    const result = await listClientProgressAction(input.data);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400, headers });
    return NextResponse.json(result.data, { headers });
  });
}
