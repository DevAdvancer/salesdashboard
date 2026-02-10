/**
 * Appwrite Database Setup Script
 *
 * This script sets up the Appwrite database and collections for SalesHub CRM.
 * It should be run once during initial project setup.
 *
 * Prerequisites:
 * 1. Create an Appwrite project at https://cloud.appwrite.io
 * 2. Update .env.local with your project ID
 * 3. Create an API key with full database permissions
 * 4. Run: npm run setup:appwrite
 *
 * This script will:
 * - Create the crm-database-1 database
 * - Create collections: users, leads, form_config, access_config
 * - Set up collection attributes and indexes
 * - Configure collection permissions
 * - Seed default access_config rules
 * - Seed default form_config with DEFAULT_FIELDS
 */

import 'dotenv/config';
import { Client, Databases, ID, Permission, Role } from 'node-appwrite';
import { DEFAULT_FIELDS } from '../lib/constants/default-fields';
import { DEFAULT_ACCESS_RULES } from '../lib/constants/default-access';

// Configuration - Read from environment variables
const ENDPOINT = process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT || 'https://cloud.appwrite.io/v1';
const PROJECT_ID = process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID;
const API_KEY = process.env.APPWRITE_API_KEY; // Server-side API key with full permissions
const DATABASE_ID = 'crm-database-1';

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

async function setupDatabase() {
  console.log('🚀 Starting Appwrite database setup...\n');
  console.log(`📍 Endpoint: ${ENDPOINT}`);
  console.log(`📦 Project: ${PROJECT_ID}`);
  console.log(`�️  Database: ${DATABASE_ID}\n`);

  try {
    // Create database
    console.log('📦 Creating database: crm-database-1');
    try {
      await databases.create(DATABASE_ID, 'CRM Database');
      console.log('✅ Database created successfully\n');
    } catch (error) {
      const err = error as { code?: number; message?: string };
      if (err.code === 409) {
        console.log('ℹ️  Database already exists\n');
      } else {
        throw error;
      }
    }

    // Create users collection
    await createUsersCollection();

    // Create leads collection
    await createLeadsCollection();

    // Create form_config collection
    await createFormConfigCollection();

    // Create access_config collection
    await createAccessConfigCollection();

    // Seed default data
    await seedDefaultData();

    console.log('\n✅ Appwrite setup completed successfully!');
    console.log('\n📝 Next steps:');
    console.log('   1. Enable Email/Password authentication in Appwrite console');
    console.log('   2. Run: npm run dev');
    console.log('   3. Create your first manager account through signup\n');

  } catch (error) {
    console.error('❌ Setup failed:', error);
    process.exit(1);
  }
}

async function createUsersCollection() {
  const COLLECTION_ID = 'users';
  console.log(`📋 Creating collection: ${COLLECTION_ID}`);

  try {
    await databases.createCollection(
      DATABASE_ID,
      COLLECTION_ID,
      'Users',
      [
        Permission.read(Role.any()),
        Permission.create(Role.guests()), // Allow guests to create during signup
        Permission.create(Role.users()),  // Allow authenticated users to create
        Permission.update(Role.users()),
        Permission.delete(Role.users()),
      ]
    );

    // Create attributes
    await databases.createStringAttribute(DATABASE_ID, COLLECTION_ID, 'name', 255, true);
    await databases.createEmailAttribute(DATABASE_ID, COLLECTION_ID, 'email', true);
    await databases.createEnumAttribute(DATABASE_ID, COLLECTION_ID, 'role', ['manager', 'agent'], true);
    await databases.createStringAttribute(DATABASE_ID, COLLECTION_ID, 'managerId', 255, false);

    // Create indexes
    await databases.createIndex(DATABASE_ID, COLLECTION_ID, 'email_idx', 'unique' as any, ['email']);
    await databases.createIndex(DATABASE_ID, COLLECTION_ID, 'role_idx', 'key' as any, ['role']);
    await databases.createIndex(DATABASE_ID, COLLECTION_ID, 'manager_idx', 'key' as any, ['managerId']);

    console.log(`✅ Collection ${COLLECTION_ID} created with attributes and indexes\n`);
  } catch (error) {
    const err = error as { code?: number; message?: string };
    if (err.code === 409) {
      console.log(`ℹ️  Collection ${COLLECTION_ID} already exists\n`);
    } else {
      throw error;
    }
  }
}

async function createLeadsCollection() {
  const COLLECTION_ID = 'leads';
  console.log(`📋 Creating collection: ${COLLECTION_ID}`);

  try {
    await databases.createCollection(
      DATABASE_ID,
      COLLECTION_ID,
      'Leads',
      [
        Permission.read(Role.any()),
        Permission.create(Role.users()),
        Permission.update(Role.users()),
        Permission.delete(Role.users()),
      ]
    );

    // Create attributes
    await databases.createStringAttribute(DATABASE_ID, COLLECTION_ID, 'data', 65535, true);
    await databases.createStringAttribute(DATABASE_ID, COLLECTION_ID, 'status', 50, true);
    await databases.createStringAttribute(DATABASE_ID, COLLECTION_ID, 'ownerId', 255, true);
    await databases.createStringAttribute(DATABASE_ID, COLLECTION_ID, 'assignedToId', 255, false);
    await databases.createBooleanAttribute(DATABASE_ID, COLLECTION_ID, 'isClosed', false, false);
    await databases.createDatetimeAttribute(DATABASE_ID, COLLECTION_ID, 'closedAt', false);

    // Create indexes
    await databases.createIndex(DATABASE_ID, COLLECTION_ID, 'owner_idx', 'key' as any, ['ownerId']);
    await databases.createIndex(DATABASE_ID, COLLECTION_ID, 'assigned_idx', 'key' as any, ['assignedToId']);
    await databases.createIndex(DATABASE_ID, COLLECTION_ID, 'status_idx', 'key' as any, ['status']);
    await databases.createIndex(DATABASE_ID, COLLECTION_ID, 'closed_idx', 'key' as any, ['isClosed']);

    console.log(`✅ Collection ${COLLECTION_ID} created with attributes and indexes\n`);
  } catch (error) {
    const err = error as { code?: number; message?: string };
    if (err.code === 409) {
      console.log(`ℹ️  Collection ${COLLECTION_ID} already exists\n`);
    } else {
      throw error;
    }
  }
}

async function createFormConfigCollection() {
  const COLLECTION_ID = 'form_config';
  console.log(`📋 Creating collection: ${COLLECTION_ID}`);

  try {
    await databases.createCollection(
      DATABASE_ID,
      COLLECTION_ID,
      'Form Configuration',
      [
        Permission.read(Role.any()),
        Permission.create(Role.users()),
        Permission.update(Role.users()),
        Permission.delete(Role.users()),
      ]
    );

    // Create attributes
    await databases.createStringAttribute(DATABASE_ID, COLLECTION_ID, 'fields', 65535, true); // JSON array
    await databases.createIntegerAttribute(DATABASE_ID, COLLECTION_ID, 'version', true, 0, 999999);
    await databases.createStringAttribute(DATABASE_ID, COLLECTION_ID, 'updatedBy', 255, true);

    // Create indexes
    await databases.createIndex(DATABASE_ID, COLLECTION_ID, 'version_idx', 'key' as any, ['version']);

    console.log(`✅ Collection ${COLLECTION_ID} created with attributes and indexes\n`);
  } catch (error) {
    const err = error as { code?: number; message?: string };
    if (err.code === 409) {
      console.log(`ℹ️  Collection ${COLLECTION_ID} already exists\n`);
    } else {
      throw error;
    }
  }
}

async function createAccessConfigCollection() {
  const COLLECTION_ID = 'access_config';
  console.log(`📋 Creating collection: ${COLLECTION_ID}`);

  try {
    await databases.createCollection(
      DATABASE_ID,
      COLLECTION_ID,
      'Access Configuration',
      [
        Permission.read(Role.any()),
        Permission.create(Role.users()),
        Permission.update(Role.users()),
        Permission.delete(Role.users()),
      ]
    );

    // Create attributes
    await databases.createStringAttribute(DATABASE_ID, COLLECTION_ID, 'componentKey', 50, true);
    await databases.createEnumAttribute(DATABASE_ID, COLLECTION_ID, 'role', ['manager', 'agent'], true);
    await databases.createBooleanAttribute(DATABASE_ID, COLLECTION_ID, 'allowed', true, false);

    // Wait for attributes to be ready
    console.log('⏳ Waiting for attributes to be ready...');
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Create unique composite index
    await databases.createIndex(DATABASE_ID, COLLECTION_ID, 'component_role_idx', 'unique' as any, ['componentKey', 'role']);

    console.log(`✅ Collection ${COLLECTION_ID} created with attributes and indexes\n`);
  } catch (error) {
    const err = error as { code?: number; message?: string };
    if (err.code === 409) {
      console.log(`ℹ️  Collection ${COLLECTION_ID} already exists\n`);
    } else {
      throw error;
    }
  }
}

async function seedDefaultData() {
  console.log('🌱 Seeding default data...\n');

  // Seed default form config
  try {
    console.log('📝 Creating default form configuration');
    const existingConfig = await databases.listDocuments(DATABASE_ID, 'form_config');

    if (existingConfig.total === 0) {
      await databases.createDocument(
        DATABASE_ID,
        'form_config',
        'current', // Use 'current' as singleton ID
        {
          fields: JSON.stringify(DEFAULT_FIELDS),
          version: 1,
          updatedBy: 'system',
        }
      );
      console.log('✅ Default form configuration created\n');
    } else {
      console.log('ℹ️  Form configuration already exists\n');
    }
  } catch (error) {
    const err = error as { code?: number; message?: string };
    if (err.code === 409) {
      console.log('ℹ️  Form configuration already exists\n');
    } else {
      console.error('⚠️  Failed to create form configuration:', err.message);
    }
  }

  // Seed default access rules
  try {
    console.log('🔐 Creating default access rules');
    let createdCount = 0;

    for (const rule of DEFAULT_ACCESS_RULES) {
      try {
        await databases.createDocument(
          DATABASE_ID,
          'access_config',
          ID.unique(),
          rule
        );
        createdCount++;
      } catch (error) {
        const err = error as { code?: number; message?: string };
        if (err.code !== 409) {
          console.error(`⚠️  Failed to create rule for ${rule.componentKey}:`, err.message);
        }
      }
    }

    if (createdCount > 0) {
      console.log(`✅ Created ${createdCount} default access rules\n`);
    } else {
      console.log('ℹ️  Access rules already exist\n');
    }
  } catch (error) {
    const err = error as { code?: number; message?: string };
    console.error('⚠️  Failed to create access rules:', err.message);
  }
}

// Run setup
setupDatabase();
