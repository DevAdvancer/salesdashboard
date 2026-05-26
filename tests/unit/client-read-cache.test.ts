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
});
