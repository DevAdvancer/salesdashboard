import { createReadThroughDatabases } from "@/lib/utils/appwrite-read-cache";

describe("Appwrite read cache", () => {
  it("dedupes identical in-flight document reads", async () => {
    const source = {
      getDocument: jest.fn().mockResolvedValue({ $id: "user-1", name: "A" }),
      listDocuments: jest.fn(),
      updateDocument: jest.fn(),
    };
    const databases = createReadThroughDatabases(source as any);

    const [first, second] = await Promise.all([
      databases.getDocument("db", "users", "user-1"),
      databases.getDocument("db", "users", "user-1"),
    ]);

    expect(first).toEqual({ $id: "user-1", name: "A" });
    expect(second).toBe(first);
    expect(source.getDocument).toHaveBeenCalledTimes(1);
  });

  it("serves recent identical list reads from memory", async () => {
    const source = {
      getDocument: jest.fn(),
      listDocuments: jest.fn().mockResolvedValue({ documents: [{ $id: "lead-1" }] }),
      updateDocument: jest.fn(),
    };
    const databases = createReadThroughDatabases(source as any);

    await databases.listDocuments("db", "leads", ["status=open"]);
    await databases.listDocuments("db", "leads", ["status=open"]);

    expect(source.listDocuments).toHaveBeenCalledTimes(1);
  });

  it("clears cached reads after a write", async () => {
    const source = {
      getDocument: jest
        .fn()
        .mockResolvedValueOnce({ $id: "user-1", name: "A" })
        .mockResolvedValueOnce({ $id: "user-1", name: "B" }),
      listDocuments: jest.fn(),
      updateDocument: jest.fn().mockResolvedValue({ $id: "user-1", name: "B" }),
    };
    const databases = createReadThroughDatabases(source as any);

    await databases.getDocument("db", "users", "user-1");
    await databases.updateDocument("db", "users", "user-1", { name: "B" });
    const refreshed = await databases.getDocument("db", "users", "user-1");

    expect(refreshed).toEqual({ $id: "user-1", name: "B" });
    expect(source.getDocument).toHaveBeenCalledTimes(2);
  });
});
