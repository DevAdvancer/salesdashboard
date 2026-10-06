import { CrmReadCoordinator } from "@/extensions/linkedin-helper/lib/crm-read-coordinator";
import type { ExtensionBootstrap, ExtensionCheck, ExtensionInput, ExtensionResponse } from "@/lib/types/linkedin-extension";

const origin = "http://localhost:5000";
const account = { id: "account", name: "Account", company: "Silverspace", type: "main" as const, connectionLimit: 100, used: 42, limit: 100, remaining: 58 };
const bootstrap: ExtensionBootstrap = { user: { id: "agent", name: "Agent" }, today: "2026-10-06", accounts: [account] };
const checked: ExtensionCheck = { user: bootstrap.user, today: bootstrap.today, account, targetUrl: "https://www.linkedin.com/in/person",
  state: "new", canRecord: true, revision: "revision", history: [], used: 42, limit: 100, remaining: 58 };
const check: ExtensionInput = { operation: "check", accountId: account.id, targetUrl: checked.targetUrl };
const record: ExtensionInput = { ...check, operation: "record", revision: checked.revision, confirmResend: false };

function fixture() {
  let stored: Parameters<ConstructorParameters<typeof CrmReadCoordinator>[0]["save"]>[0] = [];
  let now = 1_000;
  const store = { load: jest.fn(async () => stored), save: jest.fn(async entries => { stored = entries; }) };
  const fetch = jest.fn(async (_origin: string, input?: ExtensionInput): Promise<ExtensionResponse<ExtensionBootstrap | ExtensionCheck>> =>
    ({ ok: true, data: input ? checked : bootstrap }));
  return { store, fetch, create: () => new CrmReadCoordinator(store, fetch, () => now), advance: () => { now += 30_001; } };
}
function deferred() {
  let resolve!: (response: ExtensionResponse<ExtensionCheck>) => void;
  const promise = new Promise<ExtensionResponse<ExtensionCheck>>(yes => { resolve = yes; });
  return { promise, resolve };
}

it("joins an ongoing check when another popup opens and reuses the completed result", async () => {
  const f = fixture(); const worker = f.create(); const pending = deferred();
  f.fetch.mockReturnValueOnce(pending.promise);
  const firstPopup = worker.request(origin, check);
  await Promise.resolve(); await Promise.resolve();
  const reopenedPopup = worker.request(origin, check);
  pending.resolve({ ok: true, data: checked });
  expect(await firstPopup).toEqual(await reopenedPopup);
  expect(f.fetch).toHaveBeenCalledTimes(1);
  expect(await worker.request(origin, check)).toEqual({ ok: true, data: checked });
  expect(f.fetch).toHaveBeenCalledTimes(1);
});

it("restores connection and history from browser-session storage after worker suspension", async () => {
  const f = fixture(); const worker = f.create();
  await worker.request(origin); await worker.request(origin, check);
  const restarted = f.create();
  expect(await restarted.request(origin)).toEqual({ ok: true, data: bootstrap });
  expect(await restarted.request(origin, check)).toEqual({ ok: true, data: checked });
  expect(f.fetch).toHaveBeenCalledTimes(2);
});

it("isolates cached results by CRM origin, account, and profile", async () => {
  const f = fixture(); const worker = f.create();
  await worker.request(origin, check);
  await worker.request("https://other-crm.example.com", check);
  await worker.request(origin, { ...check, accountId: "other" });
  await worker.request(origin, { ...check, targetUrl: "https://www.linkedin.com/in/other" });
  expect(f.fetch).toHaveBeenCalledTimes(4);
});

it("explicit checking bypasses cached data, and cached data expires after 30 seconds", async () => {
  const f = fixture(); const worker = f.create();
  await worker.request(origin, check);
  await worker.request(origin, check, true);
  f.advance(); await worker.request(origin, check);
  expect(f.fetch).toHaveBeenCalledTimes(3);
});

it.each([401, 403])("clears all cached data on an authentication rejection (%s)", async status => {
  const f = fixture(); const worker = f.create();
  await worker.request(origin); await worker.request(origin, check);
  f.fetch.mockResolvedValueOnce({ ok: false, status, error: "Sign in" });
  await worker.request(origin, check, true);
  await worker.request(origin); await worker.request(origin, check);
  expect(f.fetch).toHaveBeenCalledTimes(5);
});

it("a fresh response for another user removes the old connection and history", async () => {
  const f = fixture(); const worker = f.create();
  await worker.request(origin); await worker.request(origin, check);
  f.fetch.mockResolvedValueOnce({ ok: true, data: { ...checked, user: { id: "other", name: "Other" } } });
  await worker.request(origin, check, true);
  await worker.request(origin);
  expect(f.fetch).toHaveBeenCalledTimes(4);
});

it("waits for a save before reopening reads and never automatically repeats the write", async () => {
  const f = fixture(); const worker = f.create();
  await worker.request(origin); await worker.request(origin, check);
  const save = deferred(); f.fetch.mockReturnValueOnce(save.promise);
  const saving = worker.request(origin, record);
  const reopen = worker.request(origin, check);
  expect(await worker.request(origin, record)).toMatchObject({ ok: false, status: 409 });
  save.resolve({ ok: true, data: { ...checked, state: "active_request", canRecord: false } });
  await saving; await reopen;
  expect(f.fetch.mock.calls.filter(([, input]) => input?.operation === "record")).toHaveLength(1);
  expect(f.fetch).toHaveBeenCalledTimes(4);
});

it("invalidates reads after an uncertain save response, so reopening checks the server", async () => {
  const f = fixture(); const worker = f.create();
  await worker.request(origin, check);
  f.fetch.mockResolvedValueOnce({ ok: false, status: 503, error: "Save response lost" });
  await worker.request(origin, record); await worker.request(origin, check);
  expect(f.fetch).toHaveBeenCalledTimes(3);
});

it("an invalidated in-flight read cannot repopulate the cache", async () => {
  const f = fixture(); const worker = f.create(); const pending = deferred();
  f.fetch.mockReturnValueOnce(pending.promise);
  const reading = worker.request(origin, check);
  await Promise.resolve(); await Promise.resolve();
  await worker.invalidate(origin);
  pending.resolve({ ok: true, data: checked }); await reading;
  await worker.request(origin, check);
  expect(f.fetch).toHaveBeenCalledTimes(2);
});

it("CRM navigation invalidation removes completed connection and history", async () => {
  const f = fixture(); const worker = f.create();
  await worker.request(origin); await worker.request(origin, check);
  await worker.invalidate(origin);
  await worker.request(origin); await worker.request(origin, check);
  expect(f.fetch).toHaveBeenCalledTimes(4);
});
