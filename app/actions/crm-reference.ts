'use server';

import { COLLECTIONS, DATABASE_ID } from '@/lib/constants/appwrite';
import { getAuthenticatedAccount } from '@/lib/server/current-user';
import { readBrowserDocument } from '@/lib/server/crm-browser-data';

/** Shared lookup services also run inside server actions. Never make a server
 * request back to localhost or depend on Appwrite's formerly public read grants. */
export async function readCrmReferenceAction(input: { databaseId: string; collectionId: string; documentId?: string; queries?: string[] }) {
  await getAuthenticatedAccount();
  if (input.databaseId !== DATABASE_ID || ![COLLECTIONS.USERS, COLLECTIONS.BRANCHES, COLLECTIONS.FORM_CONFIG].includes(input.collectionId)) {
    throw new Error('Unsupported reference collection.');
  }
  return readBrowserDocument(input.collectionId, input.documentId || null, input.queries || []);
}
