import dotenv from 'dotenv';
import { Client, Databases, IndexType } from 'node-appwrite';

dotenv.config({ path: '.env', quiet: true });
dotenv.config({ path: '.env.local', override: true, quiet: true });

const apply = process.argv.includes('--apply');
type Attribute = { key: string; size?: number; required: boolean };

async function main() {
  const { COLLECTIONS, DATABASE_ID } = await import('../lib/constants/appwrite');
  const { NEXT_PUBLIC_APPWRITE_ENDPOINT: endpoint, NEXT_PUBLIC_APPWRITE_PROJECT_ID: project, APPWRITE_API_KEY: key } = process.env;
  if (!endpoint || !project || !key) throw new Error('Appwrite endpoint, project, and API key are required.');
  const db = new Databases(new Client().setEndpoint(endpoint).setProject(project).setKey(key));
  const definitions = [
    { id: COLLECTIONS.LINKEDIN_REQUESTS, attributes: [{ key: 'conversationId', size: 36, required: false }], indexes: [
      ['dateSent'], ['acceptedAt'], ['agentId'], ['teamLeadId'],
    ] },
    { id: COLLECTIONS.LINKEDIN_CONVERSATIONS, attributes: [
      { key: 'conversationId', size: 36, required: true }, { key: 'kind', size: 12, required: true },
      { key: 'payload', size: 60000, required: true }, { key: 'agentId', size: 36, required: false },
      { key: 'teamLeadId', size: 36, required: false }, { key: 'dateSent', required: false }, { key: 'acceptedAt', required: false },
    ], indexes: [['conversationId', 'kind'], ['kind', 'dateSent'], ['kind', 'acceptedAt'], ['agentId'], ['teamLeadId']] },
  ] satisfies { id: string; attributes: Attribute[]; indexes: string[][] }[];
  const beta = await db.getCollection(DATABASE_ID, COLLECTIONS.BETA_FEATURE_ACCESS).catch(error => {
    if ((error as { code?: number }).code !== 404) throw error;
    return null;
  });
  if (!beta) console.log('The beta access collection needs setup:beta-access:dry, followed by setup:beta-access:apply.');
  console.log(`${apply ? 'APPLY' : 'DRY RUN'} LinkedIn Conversations schema. No request data or beta grants will be changed.`);
  for (const definition of definitions) {
    const isPrivate = definition.id === COLLECTIONS.LINKEDIN_CONVERSATIONS;
    const collection = await db.getCollection(DATABASE_ID, definition.id).catch(error => {
      if (!isPrivate || (error as { code?: number }).code !== 404) throw error;
      return null;
    });
    if (isPrivate && collection && (collection.$permissions.length || collection.documentSecurity)) {
      throw new Error('LinkedIn Conversations requires empty collection permissions and document security disabled.');
    }
    if (!collection) {
      console.log(`CREATE ${definition.id} with server-only permissions`);
      if (apply) await db.createCollection(DATABASE_ID, definition.id, 'LinkedIn Conversations', [], false);
    }
    for (const attribute of definition.attributes) {
      const { key: name, size, required } = attribute;
      const existing = collection?.attributes.find(item => item.key === name) as { type: string; size?: number; required: boolean; status: string } | undefined;
      if (existing) {
        if (existing.type !== (size ? 'string' : 'datetime') || existing.size !== size || existing.required !== required ||
            ['failed', 'stuck'].includes(existing.status)) throw new Error(`Check existing attribute ${definition.id}.${name}.`);
        continue;
      }
      console.log(`CREATE ${definition.id}.${name} (${size ? `string ${size}` : 'datetime'}, ${required ? 'required' : 'optional'})`);
      if (apply) {
        if (size) await db.createStringAttribute(DATABASE_ID, definition.id, name, size, required);
        else await db.createDatetimeAttribute(DATABASE_ID, definition.id, name, required);
      }
    }
    if (apply) {
      for (let attempt = 0; attempt < 60; attempt++) {
        const current = await db.getCollection(DATABASE_ID, definition.id);
        if (definition.attributes.every(attribute => current.attributes.some(item => item.key === attribute.key && item.status === 'available'))) break;
        if (attempt === 59) throw new Error(`Timed out waiting for ${definition.id} attributes.`);
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    for (const attributes of definition.indexes) {
      if (collection?.indexes.some(index => JSON.stringify(index.attributes) === JSON.stringify(attributes))) continue;
      const name = `idx_convo_${attributes.join('_')}`;
      console.log(`CREATE ${definition.id}.${name} (${attributes.join(', ')})`);
      if (apply) await db.createIndex(DATABASE_ID, definition.id, name, IndexType.Key, attributes);
    }
  }
}

main().catch(error => { console.error(error instanceof Error ? error.message : 'Schema setup failed.'); process.exitCode = 1; });
