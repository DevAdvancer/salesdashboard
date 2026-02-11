
import 'dotenv/config';
import { Client, Databases, Permission, Role } from 'node-appwrite';

// Configuration - Read from environment variables
const ENDPOINT = process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT || 'https://cloud.appwrite.io/v1';
const PROJECT_ID = process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID;
const API_KEY = process.env.APPWRITE_API_KEY; // Server-side API key with full permissions
const DATABASE_ID = process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID || 'crm-database-1';

if (!PROJECT_ID || !API_KEY) {
  console.error('❌ Missing required environment variables:');
  console.error('   NEXT_PUBLIC_APPWRITE_PROJECT_ID');
  console.error('   APPWRITE_API_KEY (server-side API key)');
  console.error('\n💡 Please update your .env.local file with these values');
  process.exit(1);
}

// Initialize Appwrite client with API key
const client = new Client()
  .setEndpoint(ENDPOINT)
  .setProject(PROJECT_ID)
  .setKey(API_KEY);

const databases = new Databases(client);

async function setupAuditLogs() {
  console.log('🚀 Starting Audit Logs setup...\n');

  const COLLECTION_ID = 'audit_logs';
  console.log(`📋 Creating collection: ${COLLECTION_ID}`);

  try {
    await databases.createCollection(
      DATABASE_ID,
      COLLECTION_ID,
      'Audit Logs',
      [
        Permission.read(Role.any()), // Frontend will filter based on user role
        Permission.create(Role.users()), // Authenticated users can create logs
        Permission.update(Role.label('admin')), // Only admins should theoretically update, but logs should be immutable usually
        Permission.delete(Role.label('admin')), // Only admins can delete
      ]
    );

    // Create attributes
    console.log('📋 Creating attributes...');
    await databases.createStringAttribute(DATABASE_ID, COLLECTION_ID, 'action', 255, true);
    await databases.createStringAttribute(DATABASE_ID, COLLECTION_ID, 'actorId', 255, true);
    await databases.createStringAttribute(DATABASE_ID, COLLECTION_ID, 'actorName', 255, true);
    await databases.createStringAttribute(DATABASE_ID, COLLECTION_ID, 'targetId', 255, false);
    await databases.createStringAttribute(DATABASE_ID, COLLECTION_ID, 'targetType', 50, true);
    await databases.createStringAttribute(DATABASE_ID, COLLECTION_ID, 'metadata', 65535, false); // JSON
    await databases.createDatetimeAttribute(DATABASE_ID, COLLECTION_ID, 'performedAt', true);

    console.log('⏳ Waiting for attributes to be ready...');
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Create indexes
    console.log('📋 Creating indexes...');
    await databases.createIndex(DATABASE_ID, COLLECTION_ID, 'performedAt_idx', 'key', ['performedAt'], ['DESC']);
    await databases.createIndex(DATABASE_ID, COLLECTION_ID, 'actorId_idx', 'key', ['actorId']);
    await databases.createIndex(DATABASE_ID, COLLECTION_ID, 'targetType_idx', 'key', ['targetType']);

    console.log(`✅ Collection ${COLLECTION_ID} created with attributes and indexes\n`);
    console.log('📝 Add this to your .env.local:');
    console.log(`NEXT_PUBLIC_APPWRITE_AUDIT_LOGS_COLLECTION_ID=${COLLECTION_ID}`);

  } catch (error: any) {
    if (error.code === 409) {
      console.log(`ℹ️  Collection ${COLLECTION_ID} already exists\n`);
    } else {
      console.error('❌ Setup failed:', error);
      process.exit(1);
    }
  }
}

setupAuditLogs();
