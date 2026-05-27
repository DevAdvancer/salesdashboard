import { Client, Account, Databases, Storage } from 'appwrite';
import { createReadThroughDatabases } from './utils/appwrite-read-cache';
export { DATABASE_ID, COLLECTIONS } from './constants/appwrite';

// Initialize Appwrite client
const client = new Client()
  .setEndpoint(process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT!)
  .setProject(process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID!);

// Export services
export const account = new Account(client);
export const databases = createReadThroughDatabases(new Databases(client));
export const storage = new Storage(client);

export { client };
