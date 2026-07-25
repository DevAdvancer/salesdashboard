import {
  bumpRequestCount,
  getRequestCount,
  withRequestMeter,
} from "@/lib/server/appwrite-request-meter";
import { createReadThroughDatabases } from "@/lib/utils/appwrite-read-cache";

function createSource() {
  return {
    getDocument: jest.fn().mockResolvedValue({ $id: "user-1" }),
    listDocuments: jest.fn().mockResolvedValue({ documents: [] }),
    updateDocument: jest.fn().mockResolvedValue({ $id: "lead-1" }),
  };
}

describe("Appwrite request meter", () => {
  it("reports zero outside a scope and ignores bumps there", () => {
    expect(getRequestCount()).toBe(0);
    bumpRequestCount();
    expect(getRequestCount()).toBe(0);
  });

  it("counts a cache miss but not a cache hit", async () => {
    const source = createSource();
    const databases = createReadThroughDatabases(source as never);

    const { count } = await withRequestMeter(async () => {
      // First call misses and goes to the network.
      await databases.listDocuments("db", "leads", ["status=open"]);
      // Second call is served from memory and must not be counted.
      await databases.listDocuments("db", "leads", ["status=open"]);
    });

    expect(source.listDocuments).toHaveBeenCalledTimes(1);
    expect(count).toBe(1);
  });

  it("counts one request per distinct read that reaches the network", async () => {
    const source = createSource();
    const databases = createReadThroughDatabases(source as never);

    const { count } = await withRequestMeter(async () => {
      await databases.listDocuments("db", "leads", ["status=open"]);
      await databases.listDocuments("db", "leads", ["status=closed"]);
      await databases.getDocument("db", "users", "user-1");
      await databases.getDocument("db", "users", "user-1");
    });

    expect(count).toBe(3);
  });

  it("does not count reads collapsed into a single in-flight request", async () => {
    const source = createSource();
    const databases = createReadThroughDatabases(source as never);

    const { count } = await withRequestMeter(async () => {
      await Promise.all([
        databases.getDocument("db", "users", "user-1"),
        databases.getDocument("db", "users", "user-1"),
      ]);
    });

    expect(source.getDocument).toHaveBeenCalledTimes(1);
    expect(count).toBe(1);
  });

  it("returns the value the measured function produced", async () => {
    const { result, count } = await withRequestMeter(async () => "done");

    expect(result).toBe("done");
    expect(count).toBe(0);
  });

  it("accumulates nested scopes into the outermost scope", async () => {
    const outer = await withRequestMeter(async () => {
      bumpRequestCount();

      const inner = await withRequestMeter(async () => {
        bumpRequestCount();
        bumpRequestCount();
        return "inner";
      });

      // The outer scope already sees what the inner scope contributed.
      expect(getRequestCount()).toBe(3);
      return inner;
    });

    // The inner scope reports only its own slice.
    expect(outer.result.count).toBe(2);
    expect(outer.result.result).toBe("inner");
    // The outer scope reports everything, its own bump included.
    expect(outer.count).toBe(3);
  });

  it("keeps concurrent scopes isolated from each other", async () => {
    const [first, second] = await Promise.all([
      withRequestMeter(async () => {
        bumpRequestCount();
        await Promise.resolve();
        bumpRequestCount();
      }),
      withRequestMeter(async () => {
        bumpRequestCount();
      }),
    ]);

    expect(first.count).toBe(2);
    expect(second.count).toBe(1);
    expect(getRequestCount()).toBe(0);
  });
});
