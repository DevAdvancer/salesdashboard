import { Query, type Databases } from 'node-appwrite';
import { COLLECTIONS, DATABASE_ID } from '@/lib/constants/appwrite';
import { listAllDocuments } from '@/lib/server/appwrite-pagination';

/** Exclude CRM users who have been inactivated, including saved report recipients. */
export async function excludeInactiveUserEmails(databases: Databases, emails: string[]): Promise<string[]> {
  if (emails.length === 0) return [];
  if (emails.every((email) => !email.trim())) return emails;
  const users = await listAllDocuments<{ email?: string; isActive?: boolean }>({
    databases,
    databaseId: DATABASE_ID,
    collectionId: COLLECTIONS.USERS,
    queries: [Query.equal('isActive', false), Query.select(['$id', 'email', 'isActive'])],
    pageLimit: 100,
    maxPages: 100,
  });
  const inactive = new Set(users.filter((user) => user.isActive === false).map((user) => user.email?.toLowerCase()));
  return emails.filter((email) => !inactive.has(email.trim().toLowerCase()));
}

type GraphRecipient = { emailAddress?: { address?: string } };

export async function excludeInactiveGraphRecipients<T extends { toRecipients?: GraphRecipient[]; ccRecipients?: GraphRecipient[]; bccRecipients?: GraphRecipient[] }>(
  databases: Databases,
  message: T,
): Promise<T> {
  const all = [...(message.toRecipients ?? []), ...(message.ccRecipients ?? []), ...(message.bccRecipients ?? [])];
  const allowed = new Set((await excludeInactiveUserEmails(databases, all.map((recipient) => recipient.emailAddress?.address ?? '')))
    .map((email) => email.toLowerCase()));
  const filter = (recipients?: GraphRecipient[]) => recipients?.filter((recipient) => allowed.has((recipient.emailAddress?.address ?? '').toLowerCase()));
  return {
    ...message,
    toRecipients: filter(message.toRecipients),
    ccRecipients: filter(message.ccRecipients),
    bccRecipients: filter(message.bccRecipients),
  };
}
