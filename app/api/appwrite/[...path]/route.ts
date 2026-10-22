import { NextRequest, NextResponse } from 'next/server';
import { COLLECTIONS, DATABASE_ID } from '@/lib/constants/appwrite';
import { CrmAccessError } from '@/lib/server/crm-access';
import { mutateBrowserBranch, readBrowserDocument } from '@/lib/server/crm-browser-data';
import { handleResumeGateway } from '@/lib/server/crm-resume-gateway';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ path: string[] }> };
async function handle(request: NextRequest, context: Context) {
  try {
    const parts = (await context.params).path;
    if (request.method !== 'GET' && request.headers.get('origin') !== request.nextUrl.origin) throw new CrmAccessError(403, 'Invalid request origin.');
    if (parts[0] === 'storage') return await handleResumeGateway(request, parts);
    if (parts[0] !== 'databases' || parts[1] !== DATABASE_ID || parts[2] !== 'collections' || parts[4] !== 'documents' || parts.length < 5 || parts.length > 6) {
      throw new CrmAccessError(404, 'Unsupported CRM data endpoint.');
    }
    const collectionId = parts[3]; const documentId = parts[5] || null;
    if (request.method === 'GET') {
      const queries = [...request.nextUrl.searchParams].filter(([key]) => /^queries(?:\[\d*\])?$/.test(key)).map(([, value]) => value);
      return NextResponse.json(await readBrowserDocument(collectionId, documentId, queries), { headers: { 'Cache-Control': 'private, no-store' } });
    }
    if (collectionId !== COLLECTIONS.BRANCHES) throw new CrmAccessError(403, 'Use the authorized CRM action for writes.');
    const raw = request.method === 'DELETE' ? '{}' : await request.text();
    if (raw.length > 4096) throw new CrmAccessError(413, 'Request too large.');
    const result = await mutateBrowserBranch(request.method, documentId, JSON.parse(raw));
    return result ? NextResponse.json(result, { status: request.method === 'POST' ? 201 : 200 }) : new NextResponse(null, { status: 204 });
  } catch (error) {
    const status = error instanceof CrmAccessError ? error.status : (error as { code?: number }).code === 404 ? 404 : 503;
    return NextResponse.json({ message: error instanceof CrmAccessError ? error.message : status === 404 ? 'Document not found.' : 'CRM data could not be loaded.', code: status }, { status, headers: { 'Cache-Control': 'no-store' } });
  }
}
export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const DELETE = handle;
