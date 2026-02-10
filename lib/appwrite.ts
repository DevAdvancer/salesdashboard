import { Client, Account, Databases } from 'appwrite';

// Initialize Appwrite client
const client = new Client()
  .setEndpoint(process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT!)
  .setProject(process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID!);

// Export services
export const account = new Account(client);
export const databases = new Databases(client);

// Export database and collection IDs
export const DATABASE_ID = process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID!;
export const COLLECTIONS = {
  USERS: process.env.NEXT_PUBLIC_APPWRITE_USERS_COLLECTION_ID!,
  LEADS: process.env.NEXT_PUBLIC_APPWRITE_LEADS_COLLECTION_ID!,
  FORM_CONFIG: process.env.NEXT_PUBLIC_APPWRITE_FORM_CONFIG_COLLECTION_ID!,
  ACCESS_CONFIG: process.env.NEXT_PUBLIC_APPWRITE_ACCESS_CONFIG_COLLECTION_ID!,
  BRANCHES: process.env.NEXT_PUBLIC_APPWRITE_BRANCHES_COLLECTION_ID!,
};

export { client };
