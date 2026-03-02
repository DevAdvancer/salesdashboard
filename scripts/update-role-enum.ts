import { Client, Databases } from 'node-appwrite';
import dotenv from 'dotenv';
import path from 'path';

// Load env vars
const envPath = path.resolve(process.cwd(), '.env.local');
console.log('Loading env from:', envPath);
dotenv.config({ path: envPath });

const ENDPOINT = process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT || 'https://cloud.appwrite.io/v1';
const PROJECT_ID = process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID;
const API_KEY = process.env.APPWRITE_API_KEY;
const DATABASE_ID = process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID || 'crm-database-1';
const USERS_COLLECTION_ID = process.env.NEXT_PUBLIC_APPWRITE_USERS_COLLECTION_ID || 'users';

console.log('Config:', {
    ENDPOINT,
    PROJECT_ID: PROJECT_ID ? PROJECT_ID.substring(0, 4) + '***' : 'MISSING',
    API_KEY: API_KEY ? 'PRESENT' : 'MISSING',
    DATABASE_ID,
    USERS_COLLECTION_ID
});

if (!PROJECT_ID || !API_KEY) {
    console.error('Missing Project ID or API Key');
    process.exit(1);
}

const client = new Client()
    .setEndpoint(ENDPOINT)
    .setProject(PROJECT_ID)
    .setKey(API_KEY);

const databases = new Databases(client);

async function run() {
    try {
        // 1. Verify connection
        console.log('Verifying connection...');
        const dbs = await databases.list();
        console.log('Databases found:', dbs.total);

        // 2. Update Enum
        console.log('Updating role enum...');
        // Note: For required enums, Appwrite API requires a default value.
        await databases.updateEnumAttribute(
            DATABASE_ID,
            USERS_COLLECTION_ID,
            'role',
            ['admin', 'manager', 'assistant_manager', 'team_lead', 'agent'],
            true, // required
            'agent' // default
        );
        console.log('Role enum updated successfully.');

    } catch (error: any) {
        console.error('Error:', error.message);
        if (error.response) {
            console.error('API Response:', JSON.stringify(error.response, null, 2));
        }
    }
}

run();
