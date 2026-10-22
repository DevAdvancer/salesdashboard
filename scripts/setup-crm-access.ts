import dotenv from 'dotenv';
import path from 'node:path';
import { Client, Databases, IndexType } from 'node-appwrite';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local'), quiet: true });
dotenv.config({ path: path.resolve(process.cwd(), '.env'), quiet: true });
const apply = process.argv.includes('--apply');
async function optional<T>(operation: () => Promise<T>) {
  try { return await operation(); } catch (error) { if ((error as { code?: number }).code === 404) return null; throw error; }
}
async function main() {
  // Resolve overrides only after both dotenv layers have been loaded.
  const { COLLECTIONS, DATABASE_ID } = await import('../lib/constants/appwrite');
  const db = new Databases(new Client().setEndpoint(process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT!)
    .setProject(process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID!).setKey(process.env.APPWRITE_API_KEY!));
  const specs = [
    { id: COLLECTIONS.SECURITY_CHALLENGES, attributes: ['data', 'expiresAt'] },
    { id: COLLECTIONS.CRM_ACCESS_REQUESTS, attributes: ['userId', 'delegateId', 'dateKey', 'state', 'data'] },
  ];
  const collections = [];
  for (const spec of specs) {
    const collection = await optional(() => db.getCollection(DATABASE_ID, spec.id));
    const attrs = (collection ? (await db.listAttributes(DATABASE_ID, spec.id)).attributes : []) as unknown as Array<{ key: string; status: string }>;
    collections.push({ ...spec, exists: !!collection, missing: spec.attributes.filter(key => !attrs.some(attr => attr.key === key)),
      permissions: collection?.$permissions || [], documentSecurity: collection?.documentSecurity });
  }
  const history = await optional(() => db.getAttribute(DATABASE_ID, COLLECTIONS.LEADS, 'history'));
  console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', emailProvider: 'Appwrite email OTP using project SMTP',
    accessEnforcementEnabled: process.env.CRM_ACCESS_ENFORCEMENT === 'true',
    collections: collections.map(item => ({ collectionId: item.id, create: !item.exists, missingAttributes: item.missing, documentAccess: 'server only' })),
    leadHistoryColumn: { create: !history, size: 60000, required: false, default: '[]' },
    activation: 'Schema only. Deploy the gateway with CRM_ACCESS_ENFORCEMENT=true and CRM_LEAD_HISTORY_SNAPSHOT=true, then run setup:crm-access:lock:dry. No existing record contents or client access settings are changed here.',
  }, null, 2));
  if (!apply) return;
  for (const spec of collections) {
    if (!spec.exists) await db.createCollection(DATABASE_ID, spec.id, spec.id, [], true, false);
    else await db.updateCollection(DATABASE_ID, spec.id, spec.id, [], true, false);
    for (const key of spec.missing) {
      if (key === 'expiresAt') await db.createDatetimeAttribute(DATABASE_ID, spec.id, key, true);
      else if (key === 'state') await db.createEnumAttribute(DATABASE_ID, spec.id, key, ['pending', 'approved', 'denied'], true);
      else await db.createStringAttribute(DATABASE_ID, spec.id, key, key === 'data' ? 4000 : key === 'dateKey' ? 10 : 255, true);
    }
  }
  if (!history) await db.createStringAttribute(DATABASE_ID, COLLECTIONS.LEADS, 'history', 60000, false, '[]');
  // Wait for schema readiness before adding indexes or changing permissions.
  for (let attempt = 0; attempt < 60; attempt++) {
    const attrs = await Promise.all(collections.map(spec => db.listAttributes(DATABASE_ID, spec.id)));
    const inline = await db.getAttribute(DATABASE_ID, COLLECTIONS.LEADS, 'history');
    const statuses = [...attrs.flatMap(result => result.attributes), inline] as unknown as Array<{ status: string }>;
    if (statuses.some(attr => attr.status === 'failed')) throw new Error('An attribute failed to become available.');
    if (statuses.every(attr => attr.status === 'available')) break;
    if (attempt === 59) throw new Error('Schema is still processing. Retry before activation.');
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  for (const spec of [
    { id: COLLECTIONS.SECURITY_CHALLENGES, key: 'expiry_idx', attributes: ['expiresAt'] },
    { id: COLLECTIONS.CRM_ACCESS_REQUESTS, key: 'user_date_idx', attributes: ['userId', 'dateKey'] },
  ]) {
    const indexes = await db.listIndexes(DATABASE_ID, spec.id);
    if (!indexes.indexes.some(index => index.key === spec.key)) await db.createIndex(DATABASE_ID, spec.id, spec.key, IndexType.Key, spec.attributes);
  }
  console.log('Schema applied. Existing client access is unchanged. Deploy and verify before the separate client-access cutover.');
}
main().catch(() => { console.error('CRM access setup could not finish. Check Appwrite connectivity and API-key scopes.'); process.exitCode = 1; });
