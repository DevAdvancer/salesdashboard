import { createHmac } from 'node:crypto';
import { ID, Permission, Role, Storage } from 'node-appwrite';
import { InputFile } from 'node-appwrite/file';
import { BUCKETS, COLLECTIONS, DATABASE_ID } from '@/lib/constants/appwrite';
import { CrmAccessError, securityDatabase } from '@/lib/server/crm-access';
import type { User } from '@/lib/types';

export const RESUME_CHUNK_SIZE = 2 * 1024 * 1024;
type Upload = { kind: 'resume-upload'; userId: string; fileId: string; name: string; total: number; parts: string[] };
function key(value: string) {
  return createHmac('sha256', process.env.APPWRITE_API_KEY!).update(`crm-upload:${value}`).digest('hex').slice(0, 36);
}
export async function uploadResumeChunk(storage: Storage, actor: User, form: FormData, range: string | null, continuation: string | null) {
  const file = form.get('file');
  if (!(file instanceof File) || file.size > RESUME_CHUNK_SIZE || !/\.(pdf|docx?|txt)$/i.test(file.name)) throw new CrmAccessError(400, 'Upload a PDF, Word or text resume.');
  const supplied = String(form.get('fileId') || '');
  const fileId = supplied === 'unique()' ? ID.unique() : supplied;
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,35}$/.test(fileId) || (continuation && continuation !== fileId)) throw new CrmAccessError(400, 'Invalid upload ID.');
  const permissions = [Permission.read(Role.user(actor.$id)), Permission.delete(Role.user(actor.$id)), Permission.update(Role.user(actor.$id)),
    ...(actor.teamLeadId ? [Permission.read(Role.user(actor.teamLeadId))] : [])];
  if (!range) return storage.createFile(BUCKETS.RESUMES, fileId, InputFile.fromBuffer(Buffer.from(await file.arrayBuffer()), file.name), permissions);
  const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(range);
  const start = Number(match?.[1]); const end = Number(match?.[2]); const total = Number(match?.[3]);
  if (!match || total > 20 * 1024 * 1024 || total <= 0 || start % RESUME_CHUNK_SIZE || end !== Math.min(start + RESUME_CHUNK_SIZE, total) - 1 || end - start + 1 !== file.size) {
    throw new CrmAccessError(400, 'Invalid upload range.');
  }
  const db = securityDatabase(); const journalId = key(`${actor.$id}:${fileId}`);
  const proposed: Upload = { kind: 'resume-upload', userId: actor.$id, fileId, name: file.name, total,
    parts: Array.from({ length: Math.ceil(total / RESUME_CHUNK_SIZE) }, (_, index) => key(`${actor.$id}:${fileId}:${index}`)) };
  // Persist only metadata. Each small temporary file fits the hosting request limit;
  // the server assembles the final file using Appwrite's required native chunk size.
  try {
    await db.createDocument(DATABASE_ID, COLLECTIONS.SECURITY_CHALLENGES, journalId,
      { data: JSON.stringify(proposed), expiresAt: new Date(Date.now() + 3600_000).toISOString() }, []);
  } catch (error) { if ((error as { code?: number }).code !== 409) throw error; }
  const doc = await db.getDocument(DATABASE_ID, COLLECTIONS.SECURITY_CHALLENGES, journalId);
  const upload = JSON.parse(doc.data) as Upload;
  if (upload.kind !== 'resume-upload' || upload.userId !== actor.$id || upload.fileId !== fileId || upload.name !== file.name || upload.total !== total || Date.parse(doc.expiresAt) <= Date.now()) {
    throw new CrmAccessError(409, 'This upload has expired or changed. Start again.');
  }
  const index = start / RESUME_CHUNK_SIZE;
  try { await storage.createFile(BUCKETS.RESUMES, upload.parts[index], InputFile.fromBuffer(Buffer.from(await file.arrayBuffer()), 'crm-upload-part.txt'), []); }
  catch (error) { if ((error as { code?: number }).code !== 409) throw error; }
  if (end + 1 !== total) return { $id: fileId, chunksTotal: upload.parts.length, chunksUploaded: index + 1 };
  const buffers = await Promise.all(upload.parts.map(id => storage.getFileDownload(BUCKETS.RESUMES, id).then(bytes => Buffer.from(bytes))));
  const assembled = Buffer.concat(buffers);
  if (assembled.byteLength !== total) throw new CrmAccessError(400, 'The upload is incomplete. Start again.');
  const result = await storage.createFile(BUCKETS.RESUMES, fileId, InputFile.fromBuffer(assembled, upload.name), permissions);
  // A failed cleanup remains in the expiry journal for the cron to retry.
  await Promise.all(upload.parts.map(id => storage.deleteFile(BUCKETS.RESUMES, id))).then(() =>
    db.deleteDocument(DATABASE_ID, COLLECTIONS.SECURITY_CHALLENGES, journalId)).catch(() => {});
  return result;
}
