import dotenv from 'dotenv';
import { Client, Account, Databases, Storage, Users, ID, Permission, Role } from 'node-appwrite';
import { InputFile } from 'node-appwrite/file';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';

dotenv.config({ path: '.env.local', quiet: true }); dotenv.config({ path: '.env', quiet: true });
async function main() {
  const apply = process.argv.includes('--apply');
  console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', plan: [
    'Create one temporary probe collection, bucket, file and unprivileged authentication account.',
    'Verify anonymous and ordinary session access before and after disabling native client access.',
    'Verify API-key reads still work, then delete only the probe resources created by this run.',
    'No existing CRM records, user sessions or collection settings are modified.',
  ] }, null, 2));
  if (!apply) return;
  const endpoint = process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT!;
  const project = process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID!;
  const makeClient = () => new Client().setEndpoint(endpoint).setProject(project);
  const admin = makeClient().setKey(process.env.APPWRITE_API_KEY!);
  const db = new Databases(admin); const storage = new Storage(admin); const users = new Users(admin);
  const databaseId = process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID || 'crm-database-1';
  const probe = `crm_gate_probe_${randomUUID().slice(0, 8)}`;
  let madeCollection = false; let madeBucket = false; let userId: string | null = null;
  const result: Record<string, boolean> = {};
  const denied = async (operation: () => Promise<unknown>) => {
    try { await operation(); return false; } catch (error) { return [401, 403, 404].includes(Number((error as { code?: number }).code)); }
  };
  try {
    await db.createCollection(databaseId, probe, 'Temporary CRM access probe', [Permission.read(Role.any())], true);
    madeCollection = true;
    await db.createStringAttribute(databaseId, probe, 'value', 64, true);
    for (let attempt = 0; attempt < 45; attempt++) {
      if (((await db.getAttribute(databaseId, probe, 'value')) as { status?: string }).status === 'available') break;
      if (attempt === 44) throw new Error('Probe schema did not become available.');
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    await db.createDocument(databaseId, probe, 'probe', { value: 'non-sensitive-probe' }, [Permission.read(Role.any())]);
    const user = await users.create(ID.unique(), undefined, undefined, undefined, 'Temporary CRM isolation probe'); userId = user.$id;
    const session = await users.createSession(userId);
    const normal = makeClient().setSession(session.secret);
    result.normalSessionIdentity = (await new Account(normal).get()).$id === userId;
    const jwt = await new Account(normal).createJWT();
    const jwtAccount = new Account(makeClient().setJWT(jwt.jwt));
    result.jwtSessionIdentity = (await jwtAccount.get()).$id === userId && (await jwtAccount.getSession('current')).$id === session.$id;
    result.publicReadBefore = !!await new Databases(makeClient()).getDocument(databaseId, probe, 'probe');
    result.sessionReadBefore = !!await new Databases(normal).getDocument(databaseId, probe, 'probe');
    await db.updateCollection(databaseId, probe, 'Temporary CRM access probe', [Permission.read(Role.any())], true, false);
    result.publicReadBlockedAfter = await denied(() => new Databases(makeClient()).getDocument(databaseId, probe, 'probe'));
    result.sessionReadBlockedAfter = await denied(() => new Databases(normal).getDocument(databaseId, probe, 'probe'));
    result.adminReadAfter = (await db.getDocument(databaseId, probe, 'probe')).value === 'non-sensitive-probe';
    await storage.createBucket(probe, 'Temporary CRM access probe', [Permission.read(Role.any())], true); madeBucket = true;
    await storage.createFile(probe, 'probe', InputFile.fromBuffer(Buffer.from('non-sensitive-probe'), 'probe.txt'), [Permission.read(Role.any())]);
    const buffer = Buffer.alloc(2 * 1024 * 1024, 65);
    await storage.createFile(probe, 'part', InputFile.fromBuffer(buffer, 'part.txt'), []);
    const part = Buffer.from(await storage.getFileDownload(probe, 'part'));
    await storage.createFile(probe, 'assembled', InputFile.fromBuffer(Buffer.concat([part, part, part]), 'probe.txt'), []);
    result.smallPartUploadAndServerAssembly = (await storage.getFile(probe, 'assembled')).sizeOriginal === buffer.length * 3;
    await storage.updateBucket(probe, 'Temporary CRM access probe', [Permission.read(Role.any())], true, false);
    result.publicFileBlocked = await denied(() => new Storage(makeClient()).getFileDownload(probe, 'probe'));
    result.sessionFileBlocked = await denied(() => new Storage(normal).getFileDownload(probe, 'probe'));
    result.adminFileReadAfter = (await storage.getFileDownload(probe, 'probe')).byteLength > 0;
  } finally {
    console.log(JSON.stringify({ completedChecks: result }, null, 2));
    if (madeBucket) await storage.deleteBucket(probe);
    if (madeCollection) await db.deleteCollection(databaseId, probe);
    if (userId) await users.delete(userId);
  }
  fs.mkdirSync('outputs', { recursive: true });
  fs.writeFileSync('outputs/crm-native-isolation-verification.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  if (!Object.values(result).every(Boolean)) throw new Error('An isolation check failed.');
}
main().catch(error => { console.error('CRM isolation verification failed.', { code: (error as { code?: number }).code || 'verification_failed', type: error.type, message: error.message }); process.exitCode = 1; });
