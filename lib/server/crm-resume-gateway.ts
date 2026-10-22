import { NextRequest, NextResponse } from 'next/server';
import { Storage } from 'node-appwrite';
import { BUCKETS } from '@/lib/constants/appwrite';
import { createAdminClient } from '@/lib/server/appwrite';
import { CrmAccessError } from '@/lib/server/crm-access';
import { verifiedBrowserActor } from '@/lib/server/crm-browser-data';
import type { User } from '@/lib/types';
import { uploadResumeChunk } from '@/lib/server/crm-resume-upload';

export function mayAccessResume(actor: User, permissions: string[], write = false) {
  if (actor.role === 'admin' || actor.role === 'developer') return true;
  if (write && (actor.role === 'monitor' || actor.role === 'operations')) return false;
  return permissions.includes(`${write ? 'delete' : 'read'}("user:${actor.$id}")`) ||
    (!write && (actor.role === 'monitor' || actor.role === 'operations'));
}
export async function handleResumeGateway(request: NextRequest, parts: string[]) {
  const actor = await verifiedBrowserActor();
  if (parts[1] !== 'buckets' || parts[2] !== BUCKETS.RESUMES || parts[3] !== 'files' || parts.length < 4 || parts.length > 6) throw new CrmAccessError(404, 'Unsupported file endpoint.');
  const fileId = parts[4]; const operation = parts[5];
  const storage: Storage = (await createAdminClient()).storage;
  if (request.method === 'POST' && !fileId) {
    if (actor.department === 'resume' || !['admin', 'developer', 'team_lead', 'senior_tl', 'agent', 'lead_generation'].includes(actor.role)) throw new CrmAccessError(403, 'You cannot upload lead resumes.');
    if (Number(request.headers.get('content-length') || 0) > 3 * 1024 * 1024) throw new CrmAccessError(413, 'Upload chunks must be smaller than 3 MB.');
    const form = await request.formData();
    const uploaded = await uploadResumeChunk(storage, actor, form, request.headers.get('content-range'), request.headers.get('x-appwrite-id'));
    return NextResponse.json(uploaded, { status: 201, headers: { 'Cache-Control': 'no-store' } });
  }
  if (!fileId) throw new CrmAccessError(403, 'File listing is not available.');
  const file = await storage.getFile(BUCKETS.RESUMES, fileId);
  if (!mayAccessResume(actor, file.$permissions, request.method === 'DELETE')) throw new CrmAccessError(403, 'You cannot access this resume.');
  if (request.method === 'DELETE' && !operation) {
    await storage.deleteFile(BUCKETS.RESUMES, fileId); return new NextResponse(null, { status: 204 });
  }
  if (request.method === 'GET' && (operation === 'view' || operation === 'download')) {
    const upstream = await fetch(`${process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT}/storage/buckets/${encodeURIComponent(BUCKETS.RESUMES)}/files/${encodeURIComponent(fileId)}/download`, {
      headers: { 'X-Appwrite-Project': process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID!, 'X-Appwrite-Key': process.env.APPWRITE_API_KEY! }, redirect: 'error', cache: 'no-store',
    });
    if (!upstream.ok || !upstream.body) throw new CrmAccessError(503, 'The resume could not be downloaded.');
    return new NextResponse(upstream.body, { headers: { 'Content-Type': file.mimeType || 'application/octet-stream', 'Cache-Control': 'private, no-store',
      'Content-Disposition': `${operation === 'view' ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(file.name)}`,
      'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "sandbox; default-src 'none'" } });
  }
  if (request.method === 'GET' && !operation) return NextResponse.json(file, { headers: { 'Cache-Control': 'no-store' } });
  throw new CrmAccessError(405, 'Unsupported file operation.');
}
