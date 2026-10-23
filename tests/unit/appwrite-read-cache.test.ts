import { createReadThroughDatabases } from "@/lib/utils/appwrite-read-cache";

describe("Appwrite read cache", () => {
  it('allows a live protection read without evicting cached lead lists for everyone', async () => {
    const source = { listDocuments: jest.fn().mockResolvedValue({ documents: [{ $id: 'lead' }] }),
      getDocument: jest.fn().mockResolvedValue({ $id: 'lead', status: 'Interested' }) };
    const db = createReadThroughDatabases(source);
    await db.listDocuments('db', 'leads', ['list']);
    await db.uncachedReads.getDocument('db', 'leads', 'lead');
    await db.uncachedReads.getDocument('db', 'leads', 'lead');
    await db.listDocuments('db', 'leads', ['list']);
    expect(source.getDocument).toHaveBeenCalledTimes(2);
    expect(source.listDocuments).toHaveBeenCalledTimes(1);
  });
  it('does not let an old read repopulate or remove a replacement read after invalidation', async () => {
    let releaseOld!: (value: string) => void; let releaseNew!: (value: string) => void;
    const old = new Promise<string>(resolve => { releaseOld = resolve; });
    const fresh = new Promise<string>(resolve => { releaseNew = resolve; });
    const source = { getDocument: jest.fn().mockReturnValueOnce(old).mockReturnValueOnce(fresh) };
    const db = createReadThroughDatabases(source);
    const first = db.getDocument('db', 'leads', 'lead');
    db.clearReadCacheForCollection('leads');
    const second = db.getDocument('db', 'leads', 'lead');
    releaseOld('old'); await first;
    const joined = db.getDocument('db', 'leads', 'lead');
    expect(source.getDocument).toHaveBeenCalledTimes(2);
    releaseNew('new');
    expect(await second).toBe('new'); expect(await joined).toBe('new');
    expect(await db.getDocument('db', 'leads', 'lead')).toBe('new');
  });
  it('propagates write failures without a detached rejected invalidation promise', async () => {
    const source = { updateDocument: jest.fn().mockRejectedValue(new Error('write failed')) };
    const db = createReadThroughDatabases(source);
    await expect(db.updateDocument('db', 'users', 'person', {})).rejects.toThrow('write failed');
    await new Promise(resolve => setTimeout(resolve, 0));
  });
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

  it("keeps identical reads cached beyond short polling intervals", async () => {
    jest.useFakeTimers();
    const source = {
      getDocument: jest.fn(),
      listDocuments: jest.fn().mockResolvedValue({ documents: [{ $id: "notification-1" }] }),
      updateDocument: jest.fn(),
    };
    const databases = createReadThroughDatabases(source as any);

    await databases.listDocuments("db", "notifications", ["recipient=user-1"]);
    jest.advanceTimersByTime(31_000);
    await databases.listDocuments("db", "notifications", ["recipient=user-1"]);

    expect(source.listDocuments).toHaveBeenCalledTimes(1);
    jest.useRealTimers();
  });

  it("shares read cache across database wrappers when stores are shared", async () => {
    const stores = {
      cache: new Map(),
      inFlight: new Map(),
    };
    const source = {
      getDocument: jest.fn().mockResolvedValue({ $id: "user-1", name: "A" }),
      listDocuments: jest.fn(),
      updateDocument: jest.fn(),
    };

    const first = createReadThroughDatabases(source as any, { namespace: "admin", stores });
    const second = createReadThroughDatabases(source as any, { namespace: "admin", stores });

    await first.getDocument("db", "users", "user-1");
    await second.getDocument("db", "users", "user-1");

    expect(source.getDocument).toHaveBeenCalledTimes(1);
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
