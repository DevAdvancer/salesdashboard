import { Query } from "node-appwrite";

export async function listAllDocuments<T>(input: {
  databases: any;
  databaseId: string;
  collectionId: string;
  queries: string[];
  pageLimit?: number;
  maxPages?: number;
  requireComplete?: boolean;
  maxDocuments?: number;
}): Promise<T[]> {
  // Keep the small default for UI lists. Large server scans may explicitly use
  // Appwrite's supported 5,000-row limit instead of paying for 50 round trips.
  let pageLimit = Math.min(Math.max(input.pageLimit ?? 100, 1), 5000);
  const maxPages = Math.max(input.maxPages ?? 1000, 1);

  const documents: T[] = [];
  let cursorAfter: string | null = null;

  for (let page = 0; page < maxPages; page += 1) {
    const pageQueries = [...input.queries, Query.limit(pageLimit)];
    if (cursorAfter) {
      pageQueries.push(Query.cursorAfter(cursorAfter));
    }

    const response = await input.databases.listDocuments(
      input.databaseId, input.collectionId, pageQueries,
    ).catch((error: { code?: number }) => {
      // Older installations can reject larger pages. Retry with their safe
      // limit rather than treating an unsupported query as an empty scan.
      if (pageLimit <= 100 || error?.code !== 400) throw error;
      pageLimit = 100;
      return input.databases.listDocuments(input.databaseId, input.collectionId,
        [...input.queries, Query.limit(pageLimit), ...(cursorAfter ? [Query.cursorAfter(cursorAfter)] : [])]);
    });

    const pageDocuments = (response?.documents ?? []) as T[];
    documents.push(...pageDocuments);
    if (input.maxDocuments && documents.length >= input.maxDocuments) {
      throw new Error('The document scan exceeded its safety limit. Ask an admin to review it.');
    }

    const moreReported = typeof response?.total === 'number' && documents.length < response.total;
    if (pageDocuments.length < pageLimit && !moreReported) {
      return documents;
    }

    const last = pageDocuments[pageDocuments.length - 1] as any;
    cursorAfter = typeof last?.$id === "string" ? last.$id : null;
    if (!cursorAfter || pageDocuments.length === 0) {
      if (input.requireComplete) throw new Error('The document scan is incomplete. Retry before continuing.');
      return documents;
    }
  }

  if (input.requireComplete) throw new Error('The document scan exceeded its safety limit. Ask an admin to review it.');
  return documents;
}
