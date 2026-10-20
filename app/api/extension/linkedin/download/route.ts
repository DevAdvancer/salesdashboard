import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { NextResponse } from 'next/server';
import { getMyLinkedinHelperAccessAction } from '@/app/actions/beta';
import { getAuthenticatedUserDoc } from '@/lib/server/current-user';
import { canUseLinkedinExtension } from '@/lib/server/linkedin-extension-policy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store', Vary: 'Cookie' };

export async function GET() {
  try {
    const beta = await getMyLinkedinHelperAccessAction();
    const actor = await getAuthenticatedUserDoc();
    if (!canUseLinkedinExtension(actor)) return NextResponse.json({ error: 'LinkedIn Helper access is unavailable.' }, { status: 403, headers });
    // Keep paths literal so Next traces only these releases, never the whole workspace.
    const bytes = beta
      ? await readFile(path.join(process.cwd(), 'releases', 'linkedin-helper', 'LinkedIn Helper.zip'))
      : await readFile(path.join(process.cwd(), 'public', 'downloads', 'crm-hub-linkedin-helper-1.7.0-chrome.zip'));
    return new NextResponse(bytes, { headers: { ...headers, 'Content-Type': 'application/zip',
      'Content-Disposition': 'attachment; filename="LinkedIn Helper.zip"', 'X-Content-Type-Options': 'nosniff' } });
  } catch {
    return NextResponse.json({ error: 'Unable to download LinkedIn Helper. Sign in and retry, or contact your administrator.' }, { status: 503, headers });
  }
}
