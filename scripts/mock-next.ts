import { mock } from "bun:test";

mock.module("../lib/server/current-user", () => ({
  assertAuthenticatedUserId: async (id: string) => {}
}));

mock.module("next/headers", () => ({
  cookies: () => ({
    get: () => undefined,
    getAll: () => []
  })
}));
