import { Client, Account, Databases } from 'appwrite';

// Initialize Appwrite client
const client = new Client()
  .setEndpoint(process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT!)
  .setProject(process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID!);

// Export services
export const account = new Account(client);
export const databases = new Databases(client);

// Export database and collection IDs
export const DATABASE_ID = process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID ?? 'crm-database-1';
export const COLLECTIONS = {
  USERS: process.env.NEXT_PUBLIC_APPWRITE_USERS_COLLECTION_ID ?? 'users',
  LEADS: process.env.NEXT_PUBLIC_APPWRITE_LEADS_COLLECTION_ID ?? 'leads',
  FORM_CONFIG: process.env.NEXT_PUBLIC_APPWRITE_FORM_CONFIG_COLLECTION_ID ?? 'form_config',
  ACCESS_CONFIG: process.env.NEXT_PUBLIC_APPWRITE_ACCESS_CONFIG_COLLECTION_ID ?? 'access_config',
  BRANCHES: process.env.NEXT_PUBLIC_APPWRITE_BRANCHES_COLLECTION_ID ?? 'branches',
};

export { client };
