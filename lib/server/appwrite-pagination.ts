import { Query } from "node-appwrite";

export async function listAllDocuments<T>(input: {
  databases: any;
  databaseId: string;
  collectionId: string;
  queries: string[];
  pageLimit?: number;
  maxPages?: number;
}): Promise<T[]> {
  const pageLimit = Math.min(Math.max(input.pageLimit ?? 100, 1), 100);
  const maxPages = Math.max(input.maxPages ?? 1000, 1);

  const documents: T[] = [];
  let cursorAfter: string | null = null;

  for (let page = 0; page < maxPages; page += 1) {
    const pageQueries = [...input.queries, Query.limit(pageLimit)];
    if (cursorAfter) {
      pageQueries.push(Query.cursorAfter(cursorAfter));
    }

    const response = await input.databases.listDocuments(
      input.databaseId,
      input.collectionId,
      pageQueries,
    );

    const pageDocuments = (response?.documents ?? []) as T[];
    documents.push(...pageDocuments);

    if (pageDocuments.length < pageLimit) {
      return documents;
    }

    const last = pageDocuments[pageDocuments.length - 1] as any;
    cursorAfter = typeof last?.$id === "string" ? last.$id : null;
    if (!cursorAfter) {
      return documents;
    }
  }

  return documents;
}
