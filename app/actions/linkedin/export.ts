'use server';

import { Query } from 'node-appwrite';
import { COLLECTIONS, DATABASE_ID } from '@/lib/constants/appwrite';
import { createAdminClient } from '@/lib/server/appwrite';
import { getAuthenticatedUserDoc } from '@/lib/server/current-user';
import { listAllDocuments } from '@/lib/server/appwrite-pagination';
import { canUseLinkedinExtension } from '@/lib/server/linkedin-extension-policy';
import { getLinkedinRequestDateFilterValue } from '@/lib/utils/linkedin-request-dates';
import { isWithdrawnLinkedinRequest } from '@/lib/utils/linkedin-request-state';
import type { LinkedinAccount, LinkedinRequest } from '@/lib/types';

/** Personal export: neither team visibility nor temporary delegation expands this scope. */
export async function exportMyLinkedinSentDataAction(date: string) {
  const actor = await getAuthenticatedUserDoc();
  if (!canUseLinkedinExtension(actor)) throw new Error('You cannot export LinkedIn requests.');
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      Number.isNaN(Date.parse(`${date}T00:00:00.000Z`)) ||
      new Date(`${date}T00:00:00.000Z`).toISOString().slice(0, 10) !== date) {
    throw new Error('Choose a valid export date.');
  }
  const { databases } = await createAdminClient();
  databases.clearReadCacheForCollection(COLLECTIONS.LINKEDIN_ACCOUNTS);
  databases.clearReadCacheForCollection(COLLECTIONS.LINKEDIN_REQUESTS);
  const accounts = await listAllDocuments<LinkedinAccount>({ databases, databaseId: DATABASE_ID,
    collectionId: COLLECTIONS.LINKEDIN_ACCOUNTS,
    queries: [Query.equal('assignedUserId', actor.$id),
      Query.select(['$id', 'assignedUserId', 'idName', 'accountType'])] });
  const ownAccounts = new Map(accounts.filter(account => account.assignedUserId === actor.$id)
    .map(account => [account.$id, account]));
  if (!ownAccounts.size) return [];
  // dateSent is the Eastern business calendar date stored at UTC midnight.
  const requests = await listAllDocuments<LinkedinRequest>({ databases, databaseId: DATABASE_ID,
    collectionId: COLLECTIONS.LINKEDIN_REQUESTS,
    queries: [Query.equal('agentId', actor.$id),
      Query.greaterThanEqual('dateSent', `${date}T00:00:00.000Z`),
      Query.lessThanEqual('dateSent', `${date}T23:59:59.999Z`), Query.orderAsc('$id'),
      Query.select(['$id', 'agentId', 'accountId', 'company', 'targetUrl', 'dateSent', 'status', 'isActive', 'withdrawnAt', 'coldCall'])] });
  return requests.filter(request => request.agentId === actor.$id && ownAccounts.has(request.accountId) &&
    !request.coldCall && getLinkedinRequestDateFilterValue(request.dateSent) === date)
    .map(request => ({
      Date: date,
      Account: ownAccounts.get(request.accountId)!.idName,
      Type: ownAccounts.get(request.accountId)!.accountType,
      Company: request.company,
      'Profile URL': request.targetUrl,
      Status: isWithdrawnLinkedinRequest(request) ? 'withdrawn' : request.status,
    }));
}
