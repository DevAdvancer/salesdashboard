import {
  cacheClientRead,
  clearClientReadCache,
} from "@/lib/utils/client-read-cache";

describe("client read cache", () => {
  beforeEach(() => {
    clearClientReadCache();
  });

  it("dedupes identical in-flight reads", async () => {
    const read = jest.fn().mockResolvedValue(["one"]);

    const [first, second] = await Promise.all([
      cacheClientRead("notifications", ["user-1"], read),
      cacheClientRead("notifications", ["user-1"], read),
    ]);

    expect(first).toBe(second);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("serves identical reads from local memory during the default ttl", async () => {
    jest.useFakeTimers();
    const read = jest.fn().mockResolvedValue(["one"]);

    await cacheClientRead("notifications", ["user-1"], read);
    jest.advanceTimersByTime(31_000);
    await cacheClientRead("notifications", ["user-1"], read);

    expect(read).toHaveBeenCalledTimes(1);
    jest.useRealTimers();
  });

  it("clears cached reads on demand", async () => {
    const read = jest.fn().mockResolvedValue(["one"]);

    await cacheClientRead("notifications", ["user-1"], read);
    clearClientReadCache();
    await cacheClientRead("notifications", ["user-1"], read);

    expect(read).toHaveBeenCalledTimes(2);
  });

  it("clears only matching cache scopes when a scope prefix is provided", async () => {
    const readNotifications = jest.fn().mockResolvedValue(["notification"]);
    const readLeads = jest.fn().mockResolvedValue(["lead"]);

    await cacheClientRead("sop:listNotifications", ["user-1"], readNotifications);
    await cacheClientRead("lead:listLeads", ["user-1"], readLeads);

    clearClientReadCache("lead:");

    await cacheClientRead("sop:listNotifications", ["user-1"], readNotifications);
    await cacheClientRead("lead:listLeads", ["user-1"], readLeads);

    expect(readNotifications).toHaveBeenCalledTimes(1);
    expect(readLeads).toHaveBeenCalledTimes(2);
  });

  it("force refreshes a cached read while still sharing the refreshed response", async () => {
    const read = jest
      .fn()
      .mockResolvedValueOnce(["old"])
      .mockResolvedValueOnce(["new"]);

    await cacheClientRead("notifications", ["user-1"], read);

    const [first, second] = await Promise.all([
      cacheClientRead("notifications", ["user-1"], read, { forceRefresh: true }),
      cacheClientRead("notifications", ["user-1"], read, { forceRefresh: true }),
    ]);

    expect(first).toEqual(["new"]);
    expect(second).toBe(first);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("uses stable keys for equivalent object arguments", async () => {
    const read = jest.fn().mockResolvedValue(["one"]);

    await cacheClientRead("lead:listLeads", [{ status: "New", isClosed: false }], read);
    await cacheClientRead("lead:listLeads", [{ isClosed: false, status: "New" }], read);

    expect(read).toHaveBeenCalledTimes(1);
  });

  it("does not repopulate cache from an in-flight read after invalidation", async () => {
    let resolveRead: (value: string[]) => void = () => {};
    const staleRead = new Promise<string[]>((resolve) => {
      resolveRead = resolve;
    });
    const read = jest
      .fn()
      .mockReturnValueOnce(staleRead)
      .mockResolvedValueOnce(["fresh"]);

    const pending = cacheClientRead("lead:listLeads", ["user-1"], read);
    clearClientReadCache("lead:");
    resolveRead(["stale"]);

    await pending;
    const refreshed = await cacheClientRead("lead:listLeads", ["user-1"], read);

    expect(refreshed).toEqual(["fresh"]);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("force refresh bypasses an older normal in-flight read", async () => {
    let resolveStaleRead: (value: string[]) => void = () => {};
    const staleRead = new Promise<string[]>((resolve) => {
      resolveStaleRead = resolve;
    });
    const read = jest
      .fn()
      .mockReturnValueOnce(staleRead)
      .mockResolvedValueOnce(["fresh"]);

    const pending = cacheClientRead("notifications", ["user-1"], read);
    const refreshed = await cacheClientRead("notifications", ["user-1"], read, {
      forceRefresh: true,
    });
    resolveStaleRead(["stale"]);

    await pending;

    expect(refreshed).toEqual(["fresh"]);
    expect(read).toHaveBeenCalledTimes(2);
  });
});
