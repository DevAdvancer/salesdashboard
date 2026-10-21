/** Dry-run by default. Adds only users.primaryBranchId; never rewrites users. */
import dotenv from 'dotenv';
import { Client, Databases } from 'node-appwrite';
dotenv.config({ path: '.env.local', quiet: true });
dotenv.config({ path: '.env', quiet: true });

async function main() {
  const { COLLECTIONS, DATABASE_ID } = await import('../lib/constants/appwrite');
  const db = new Databases(new Client().setEndpoint(process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT!)
    .setProject(process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID!).setKey(process.env.APPWRITE_API_KEY!));
  const collection = await db.getCollection(DATABASE_ID, COLLECTIONS.USERS);
  const attribute = collection.attributes.find(value => value.key === 'primaryBranchId');
  const changes = attribute ? [] : ['ADD users.primaryBranchId: optional string(255); no user data changes'];
  const apply = process.argv.includes('--apply');
  console.log(JSON.stringify({ mode: apply ? 'APPLY' : 'DRY RUN', changes,
    existingStatus: attribute?.status ?? null, userWrites: 0 }, null, 2));
  if (apply && !attribute) await db.createStringAttribute(DATABASE_ID, COLLECTIONS.USERS, 'primaryBranchId', 255, false);
  if (apply) {
    for (let attempt = 0; attempt < 30; attempt++) {
      const current = await db.getAttribute(DATABASE_ID, COLLECTIONS.USERS, 'primaryBranchId');
      if (current.status === 'available') { console.log('users.primaryBranchId is available'); return; }
      if (current.status === 'failed') throw new Error('Primary branch attribute failed');
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    throw new Error('Primary branch attribute is not available yet');
  }
}
main().catch(error => { console.error((error as Error).message); process.exitCode = 1; });
