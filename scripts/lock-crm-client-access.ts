import dotenv from 'dotenv';
import { Client, Databases, Query, Storage, type Compression } from 'node-appwrite';
import fs from 'node:fs';
import path from 'node:path';
dotenv.config({ path: '.env.local', quiet: true }); dotenv.config({ path: '.env', quiet: true });

async function main() {
  const apply = process.argv.includes('--apply');
  const { BUCKETS, DATABASE_ID } = await import('../lib/constants/appwrite');
  const client = new Client().setEndpoint(process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT!)
    .setProject(process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID!).setKey(process.env.APPWRITE_API_KEY!);
  const db = new Databases(client); const storage = new Storage(client);
  const restorePath = process.argv.find(arg => arg.startsWith('--restore='))?.slice('--restore='.length);
  if (restorePath) {
    const snapshot = JSON.parse(fs.readFileSync(path.resolve(restorePath), 'utf8'));
    if (snapshot.project !== process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID || snapshot.database !== DATABASE_ID || snapshot.bucket.$id !== BUCKETS.RESUMES) throw new Error('Backup scope does not match this CRM.');
    console.log(JSON.stringify({ mode: apply ? 'restore' : 'restore-dry', collections: snapshot.collections.map((row: { $id: string; enabled: boolean }) => ({ id: row.$id, enabled: row.enabled })), bucket: { id: snapshot.bucket.$id, enabled: snapshot.bucket.enabled } }, null, 2));
    if (!apply) return;
    for (const row of snapshot.collections) {
      const current = await db.getCollection(DATABASE_ID, row.$id);
      await db.updateCollection(DATABASE_ID, row.$id, current.name, current.$permissions, current.documentSecurity, row.enabled);
    }
    const current = await storage.getBucket(BUCKETS.RESUMES);
    await storage.updateBucket(current.$id, current.name, current.$permissions, current.fileSecurity, snapshot.bucket.enabled,
      current.maximumFileSize, current.allowedFileExtensions, current.compression as Compression, current.encryption, current.antivirus);
    console.log('Original native client access settings restored.'); return;
  }
  const collections = []; let cursor: string | undefined;
  do {
    const page = await db.listCollections(DATABASE_ID, [Query.limit(100), ...(cursor ? [Query.cursorAfter(cursor)] : [])]);
    collections.push(...page.collections);
    cursor = page.collections.length === 100 ? page.collections.at(-1)!.$id : undefined;
  } while (cursor);
  const bucket = await storage.getBucket(BUCKETS.RESUMES);
  const origin = process.env.CRM_PUBLIC_URL || 'https://crm.silverspaceinc.tech';
  if (new URL(origin).protocol !== 'https:') throw new Error('Cutover requires the deployed HTTPS CRM URL.');
  let readiness: { protocol?: string; cutoverReady?: boolean } = {};
  try { const response = await fetch(new URL('/api/security/readiness', origin), { signal: AbortSignal.timeout(15_000), redirect: 'error' }); if (response.ok) readiness = await response.json(); } catch { /* Report as not ready. */ }
  const ready = readiness.protocol === 'crm-gateway-native-mfa-v1' && readiness.cutoverReady === true;
  console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', database: DATABASE_ID, deployedGatewayReady: ready,
    collections: collections.filter(row => row.enabled).map(row => ({ id: row.$id, enabledBefore: true, enabledAfter: false })),
    bucket: { id: bucket.$id, enabledBefore: bucket.enabled, enabledAfter: false },
    effect: 'Native anonymous/session reads and writes stop. Server API-key access remains. Record contents and ACLs are preserved. Only this configured database and bucket are changed.' }, null, 2));
  if (!apply) return;
  if (!ready) throw new Error('Cutover refused: deploy and enable the new gateway first.');
  fs.mkdirSync('outputs', { recursive: true });
  const backup = path.resolve(`outputs/crm-client-access-${Date.now()}.json`);
  fs.writeFileSync(backup, JSON.stringify({ project: process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID, database: DATABASE_ID, collections, bucket }, null, 2), { flag: 'wx' });
  console.log(`Rollback snapshot: ${backup}`);
  for (const row of collections) if (row.enabled) await db.updateCollection(DATABASE_ID, row.$id, row.name, row.$permissions, row.documentSecurity, false);
  if (bucket.enabled) await storage.updateBucket(bucket.$id, bucket.name, bucket.$permissions, bucket.fileSecurity, false,
    bucket.maximumFileSize, bucket.allowedFileExtensions, bucket.compression as Compression, bucket.encryption, bucket.antivirus);
  const final = await fetch(new URL('/api/security/readiness', origin), { signal: AbortSignal.timeout(15_000) }).then(response => response.json());
  if (!final.nativeClientIsolation) throw new Error(`Cutover needs attention. Preserve rollback snapshot: ${backup}`);
  console.log('Native client isolation verified on the deployed CRM.');
}
main().catch(error => { console.error('CRM client-access operation stopped:', error instanceof Error ? error.message : 'Appwrite operation failed.'); process.exitCode = 1; });
