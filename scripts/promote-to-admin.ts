/**
 * Promote User to Admin Script
 *
 * This script promotes an existing user to the admin role.
 * Use this to create your first admin user after initial signup.
 *
 * Prerequisites:
 * 1. User must already exist (created through signup)
 * 2. APPWRITE_API_KEY must be set in .env with full permissions
 *
 * Usage:
 *   npm run promote-admin <user-email>
 *
 * Example:
 *   npm run promote-admin john@example.com
 */

import 'dotenv/config';
import { Client, Databases, Query } from 'node-appwrite';

// Validate environment variables
const ENDPOINT = process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT;
const PROJECT_ID = process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID;
const API_KEY = process.env.APPWRITE_API_KEY;
const DATABASE_ID = process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID;
const USERS_COLLECTION_ID = process.env.NEXT_PUBLIC_APPWRITE_USERS_COLLECTION_ID;

if (!ENDPOINT || !PROJECT_ID || !API_KEY || !DATABASE_ID || !USERS_COLLECTION_ID) {
  console.error('❌ Missing required environment variables:');
  if (!ENDPOINT) console.error('   - NEXT_PUBLIC_APPWRITE_ENDPOINT');
  if (!PROJECT_ID) console.error('   - NEXT_PUBLIC_APPWRITE_PROJECT_ID');
  if (!API_KEY) console.error('   - APPWRITE_API_KEY');
  if (!DATABASE_ID) console.error('   - NEXT_PUBLIC_APPWRITE_DATABASE_ID');
  if (!USERS_COLLECTION_ID) console.error('   - NEXT_PUBLIC_APPWRITE_USERS_COLLECTION_ID');
  console.error('\n💡 Please update your .env file with these values');
  process.exit(1);
}

// Initialize Appwrite client
const client = new Client()
  .setEndpoint(ENDPOINT)
  .setProject(PROJECT_ID)
  .setKey(API_KEY);

const databases = new Databases(client);

async function promoteToAdmin(email: string) {
  console.log('🔍 Searching for user:', email);
  
  try {
    // Find user by email
    const users = await databases.listDocuments(
      DATABASE_ID,
      USERS_COLLECTION_ID,
      [Query.equal('email', email)]
    );

    if (users.total === 0) {
      console.error(`❌ User not found: ${email}`);
      console.error('\n💡 Make sure the user has signed up first');
      process.exit(1);
    }

    const user = users.documents[0];
    const currentRole = user.role;
    
    console.log('✅ User found:');
    console.log(`   ID: ${user.$id}`);
    console.log(`   Name: ${user.name}`);
    console.log(`   Email: ${user.email}`);
    console.log(`   Current Role: ${currentRole}`);
    
    if (currentRole === 'admin') {
      console.log('\nℹ️  User is already an admin. No changes needed.');
      process.exit(0);
    }
    
    console.log('\n🔄 Promoting user to admin...');
    
    // Update role to admin
    await databases.updateDocument(
      DATABASE_ID,
      USERS_COLLECTION_ID,
      user.$id,
      { role: 'admin' }
    );

    console.log('✅ Successfully promoted user to admin!');
    console.log(`   ${currentRole} → admin`);
    console.log('\n📝 The user can now:');
    console.log('   - Create and manage managers');
    console.log('   - Access all system features');
    console.log('   - Manage branches (if branch management is enabled)');
    
  } catch (error: any) {
    console.error('❌ Failed to promote user:', error.message || error);
    if (error.code) {
      console.error(`   Error code: ${error.code}`);
    }
    process.exit(1);
  }
}

// Parse command line arguments
const email = process.argv[2];

if (!email) {
  console.error('❌ Missing required argument: user email');
  console.error('\nUsage:');
  console.error('   npm run promote-admin <user-email>');
  console.error('\nExample:');
  console.error('   npm run promote-admin john@example.com');
  process.exit(1);
}

// Validate email format
const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
if (!emailRegex.test(email)) {
  console.error('❌ Invalid email format:', email);
  process.exit(1);
}

// Run the promotion
promoteToAdmin(email);
