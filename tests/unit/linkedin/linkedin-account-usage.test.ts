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

  it("counts every saved request for each account across pages", async () => {
    const rows = [
      ...Array.from({ length: 123 }, (_, index) => ({ $id: `main-${index}`, accountId: "main-id" })),
      ...Array.from({ length: 2 }, (_, index) => ({ $id: `sudo-${index}`, accountId: "sudo-id" })),
    ];
    const databases = {
      clearReadCacheForCollection: jest.fn(),
      listDocuments: jest.fn().mockResolvedValueOnce({ documents: rows.slice(0, 100) })
        .mockResolvedValueOnce({ documents: rows.slice(100) }),
    };

    expect(await getLinkedinAccountUsageByAccount(databases as never,
      ["main-id", "sudo-id", "empty-id"], "2026-10-14T00:00:00.000Z"))
      .toEqual({ "main-id": 123, "sudo-id": 2, "empty-id": 0 });
    expect(databases.listDocuments).toHaveBeenCalledTimes(2);
    expect(databases.clearReadCacheForCollection).toHaveBeenCalledWith(COLLECTIONS.LINKEDIN_REQUESTS);
  });
});
jest.mock("node-appwrite", () => ({ Query: {
  equal: (attribute: string, value: string) => JSON.stringify({ attribute, value }),
  select: (fields: string[]) => JSON.stringify({ select: fields }),
  limit: (value: number) => JSON.stringify({ limit: value }),
  cursorAfter: (value: string) => JSON.stringify({ cursorAfter: value }),
} }));
