/** @jest-environment node */
import { File } from 'node:buffer';
import { RESUME_CHUNK_SIZE, uploadResumeChunk } from '@/lib/server/crm-resume-upload';
import { securityDatabase } from '@/lib/server/crm-access';
import type { Storage } from 'node-appwrite';
import type { User } from '@/lib/types';
jest.mock('@/lib/server/crm-access', () => ({ securityDatabase: jest.fn(), CrmAccessError: class extends Error { constructor(public status: number, message: string) { super(message); } } }));
const actor = { $id: 'owner', role: 'agent', teamLeadId: 'tl' } as User;
let records: Map<string, any>; let files: Map<string, Buffer>; let storage: Storage;
const oldKey = process.env.APPWRITE_API_KEY;
beforeEach(() => {
  process.env.APPWRITE_API_KEY = 'unit-test-key'; records = new Map(); files = new Map();
  (securityDatabase as jest.Mock).mockReturnValue({
    createDocument: jest.fn(async (_db, _col, id, data) => { if (records.has(id)) throw { code: 409 }; records.set(id, data); }),
    getDocument: jest.fn(async (_db, _col, id) => records.get(id)), deleteDocument: jest.fn(async (_db, _col, id) => records.delete(id)),
  });
  storage = {
    createFile: jest.fn(async (_bucket, id, input) => { if (files.has(id)) throw { code: 409 }; files.set(id, Buffer.from(await input.arrayBuffer())); return { $id: id }; }),
    getFileDownload: jest.fn(async (_bucket, id) => { if (!files.has(id)) throw { code: 404 }; return files.get(id); }),
    deleteFile: jest.fn(async (_bucket, id) => files.delete(id)),
  } as unknown as Storage;
});
afterEach(() => { if (oldKey === undefined) delete process.env.APPWRITE_API_KEY; else process.env.APPWRITE_API_KEY = oldKey; });
function form(bytes: Buffer, id = 'resume', name = 'resume.pdf') {
  const data = new FormData(); data.set('fileId', id); data.set('file', new File([new Uint8Array(bytes)], name) as unknown as Blob); data.set('permissions[0]', 'read("any")'); return data;
}
it('assembles browser parts into the native file with server-owned permissions and cleans up parts', async () => {
  const first = Buffer.alloc(RESUME_CHUNK_SIZE, 65); const last = Buffer.from('last'); const total = first.length + last.length;
  await uploadResumeChunk(storage, actor, form(first), `bytes 0-${first.length - 1}/${total}`, null);
  await uploadResumeChunk(storage, actor, form(last), `bytes ${first.length}-${total - 1}/${total}`, 'resume');
  expect(files.get('resume')).toEqual(Buffer.concat([first, last]));
  expect(files.size).toBe(1); expect(records.size).toBe(0);
  const call = (storage.createFile as jest.Mock).mock.calls.at(-1)!;
  expect(call[3]).not.toContain('read("any")'); expect(call[3]).toContain('read("user:owner")');
});
it('rejects changed ownership/metadata, invalid ranges and oversized chunks', async () => {
  const first = Buffer.alloc(RESUME_CHUNK_SIZE); const total = first.length + 5;
  await uploadResumeChunk(storage, actor, form(first), `bytes 0-${first.length - 1}/${total}`, null);
  await expect(uploadResumeChunk(storage, actor, form(Buffer.alloc(5), 'resume', 'changed.pdf'), `bytes ${first.length}-${total - 1}/${total}`, 'resume')).rejects.toThrow('changed');
  await expect(uploadResumeChunk(storage, actor, form(Buffer.alloc(5)), 'bytes 1-5/6', null)).rejects.toThrow('range');
  await expect(uploadResumeChunk(storage, actor, form(Buffer.alloc(RESUME_CHUNK_SIZE + 1)), null, null)).rejects.toThrow('Upload');
});
