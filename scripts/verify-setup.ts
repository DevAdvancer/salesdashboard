/**
 * Appwrite Setup Verification Script
 *
 * This script verifies that your Appwrite database is correctly configured.
 * Run this if you're experiencing authentication issues.
 */

import 'dotenv/config';
import { Client, Databases } from 'node-appwrite';

const ENDPOINT = process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT || 'https://cloud.appwrite.io/v1';
const PROJECT_ID = process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID;
const API_KEY = process.env.APPWRITE_API_KEY;
const DATABASE_ID = 'crm-database-1';

if (!PROJECT_ID || !API_KEY) {
  console.error('❌ Missing environment variables');
  process.exit(1);
}

const client = new Client()
  .setEndpoint(ENDPOINT)
  .setProject(PROJECT_ID)
  .setKey(API_KEY);

const databases = new Databases(client);

async function verifySetup() {
  console.log('🔍 Verifying Appwrite Setup\n');
  console.log(`📍 Endpoint: ${ENDPOINT}`);
  console.log(`📦 Project: ${PROJECT_ID}`);
  console.log(`🗄️  Database: ${DATABASE_ID}\n`);

  let hasErrors = false;

  try {
    // Check database exists
    console.log('1️⃣ Checking database...');
    try {
      const db = await databases.get(DATABASE_ID);
      console.log(`   ✅ Database "${db.name}" exists\n`);
    } catch (error) {
      console.log('   ❌ Database not found');
      console.log('   💡 Run: npm run setup:appwrite\n');
      hasErrors = true;
      return;
    }

    // Check collections
    console.log('2️⃣ Checking collections...');
    const collections = await databases.listCollections(DATABASE_ID);
    const requiredCollections = ['users', 'leads', 'form_config', 'access_config'];

    for (const collectionId of requiredCollections) {
      const found = collections.collections.find(c => c.$id === collectionId);
      if (found) {
        console.log(`   ✅ Collection "${found.name}" (${collectionId})`);
      } else {
        console.log(`   ❌ Collection "${collectionId}" not found`);
        hasErrors = true;
      }
    }
    console.log();

    // Check users collection attributes
    console.log('3️⃣ Checking users collection attributes...');
    try {
      const usersCollection = await databases.getCollection(DATABASE_ID, 'users');
      const requiredAttributes = [
        { key: 'name', type: 'string' },
        { key: 'email', type: 'email' },
        { key: 'role', type: 'string' },
        { key: 'managerId', type: 'string' },
      ];

      for (const attr of requiredAttributes) {
        const found = usersCollection.attributes.find((a: any) => a.key === attr.key);
        if (found) {
          console.log(`   ✅ Attribute "${attr.key}" (${found.type})`);
        } else {
          console.log(`   ❌ Attribute "${attr.key}" not found`);
          hasErrors = true;
        }
      }
      console.log();

      // Check permissions
      console.log('4️⃣ Checking users collection permissions...');
      const permissions = usersCollection.$permissions || [];

      const hasReadAny = permissions.some((p: string) => p.includes('read("any")'));
      const hasCreateUsers = permissions.some((p: string) => p.includes('create("users")'));
      const hasUpdateUsers = permissions.some((p: string) => p.includes('update("users")'));
      const hasDeleteUsers = permissions.some((p: string) => p.includes('delete("users")'));

      if (hasReadAny) {
        console.log('   ✅ Read permission: Any');
      } else {
        console.log('   ❌ Read permission: Any - MISSING');
        console.log('   💡 Add this permission in Appwrite Console');
        hasErrors = true;
      }

      if (hasCreateUsers) {
        console.log('   ✅ Create permission: Users');
      } else {
        console.log('   ❌ Create permission: Users - MISSING');
        console.log('   💡 Add this permission in Appwrite Console');
        hasErrors = true;
      }

      if (hasUpdateUsers) {
        console.log('   ✅ Update permission: Users');
      } else {
        console.log('   ❌ Update permission: Users - MISSING');
        console.log('   💡 Add this permission in Appwrite Console');
        hasErrors = true;
      }

      if (hasDeleteUsers) {
        console.log('   ✅ Delete permission: Users');
      } else {
        console.log('   ❌ Delete permission: Users - MISSING');
        console.log('   💡 Add this permission in Appwrite Console');
        hasErrors = true;
      }
      console.log();

    } catch (error) {
      console.log('   ❌ Could not check users collection');
      hasErrors = true;
    }

    // Check default data
    console.log('5️⃣ Checking default data...');

    try {
      const formConfig = await databases.listDocuments(DATABASE_ID, 'form_config');
      if (formConfig.total > 0) {
        console.log(`   ✅ Form config exists (${formConfig.total} document(s))`);
      } else {
        console.log('   ⚠️  Form config not seeded');
        console.log('   💡 Run: npm run setup:appwrite');
      }
    } catch (error) {
      console.log('   ❌ Could not check form config');
    }

    try {
      const accessConfig = await databases.listDocuments(DATABASE_ID, 'access_config');
      if (accessConfig.total > 0) {
        console.log(`   ✅ Access config exists (${accessConfig.total} rule(s))`);
      } else {
        console.log('   ⚠️  Access config not seeded');
        console.log('   💡 Run: npm run setup:appwrite');
      }
    } catch (error) {
      console.log('   ❌ Could not check access config');
    }
    console.log();

    // Summary
    if (hasErrors) {
      console.log('❌ Setup verification failed');
      console.log('\n📝 Next steps:');
      console.log('   1. Fix the issues listed above');
      console.log('   2. Run: npm run setup:appwrite');
      console.log('   3. Check Appwrite Console for permissions');
      console.log('   4. Run this script again to verify\n');
      process.exit(1);
    } else {
      console.log('✅ All checks passed!');
      console.log('\n📝 Your Appwrite setup is correct.');
      console.log('   If you\'re still having issues:');
      console.log('   1. Restart your dev server: npm run dev');
      console.log('   2. Clear browser cache or use incognito mode');
      console.log('   3. Check browser console for errors');
      console.log('   4. Visit: http://localhost:3000/test-auth\n');
    }

  } catch (error: any) {
    console.error('❌ Verification failed:', error.message);
    process.exit(1);
  }
}

verifySetup();
