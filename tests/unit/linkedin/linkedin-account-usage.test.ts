import { getLinkedinAccountUsage, getLinkedinAccountUsageByAccount } from "@/lib/server/linkedin-account-usage";
import { COLLECTIONS, DATABASE_ID } from "@/lib/constants/appwrite";

describe("LinkedIn account daily usage", () => {
  it("uses Appwrite's full total after clearing stale reads", async () => {
    const databases = {
      clearReadCacheForCollection: jest.fn(),
      listDocuments: jest.fn().mockResolvedValue({ total: 23, documents: [{ $id: "one" }] }),
    };
    const used = await getLinkedinAccountUsage(
      databases as never, "main-id", "2026-10-14T00:00:00.000Z",
    );

    expect(used).toBe(23);
    expect(databases.clearReadCacheForCollection).toHaveBeenCalledWith(COLLECTIONS.LINKEDIN_REQUESTS);
    expect(databases.listDocuments).toHaveBeenCalledWith(
      DATABASE_ID, COLLECTIONS.LINKEDIN_REQUESTS,
      expect.arrayContaining([expect.stringContaining('"attribute":"accountId"'),
        expect.stringContaining('"attribute":"dateSent"')]),
    );
  });

  it("counts each account with one total query instead of reading every row", async () => {
    const totals: Record<string, number> = { "main-id": 123, "sudo-id": 2, "empty-id": 0 };
    const databases = {
      clearReadCacheForCollection: jest.fn(),
      listDocuments: jest.fn().mockImplementation((_db: string, _collection: string, queries: string[]) => {
        const account = queries.map((query) => JSON.parse(query)).find((query) => query.attribute === "accountId");
        return Promise.resolve({ total: totals[account.value], documents: [] });
      }),
    };

    expect(await getLinkedinAccountUsageByAccount(databases as never,
      ["main-id", "sudo-id", "empty-id"], "2026-10-14T00:00:00.000Z"))
      .toEqual({ "main-id": 123, "sudo-id": 2, "empty-id": 0 });
    expect(databases.listDocuments).toHaveBeenCalledTimes(3);
    for (const [, , queries] of databases.listDocuments.mock.calls) {
      expect(queries).toContain(JSON.stringify({ limit: 1 }));
    }
    expect(databases.clearReadCacheForCollection).toHaveBeenCalledWith(COLLECTIONS.LINKEDIN_REQUESTS);
  });
});
jest.mock("node-appwrite", () => ({ Query: {
  equal: (attribute: string, value: string) => JSON.stringify({ attribute, value }),
  select: (fields: string[]) => JSON.stringify({ select: fields }),
  limit: (value: number) => JSON.stringify({ limit: value }),
  cursorAfter: (value: string) => JSON.stringify({ cursorAfter: value }),
} }));
