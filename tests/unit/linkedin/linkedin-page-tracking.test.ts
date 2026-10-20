jest.mock("crm-shared/utils/linkedin-extension-url", () => jest.requireActual("@/lib/utils/linkedin-extension-url"), { virtual: true });
jest.mock("crm-shared/utils/eastern-date", () => jest.requireActual("@/lib/utils/eastern-date"), { virtual: true });
import { PageTracking, type PageStatus, type TrackingAttempt, type TrackingLock, type TrackingRequest, type TrackingPreview } from "@/extensions/linkedin-helper/lib/page-tracking";
import type { ExtensionBootstrap, ExtensionCheck, ExtensionInput } from "@/lib/types/linkedin-extension";

const origin = "http://localhost:5000";
const targetUrl = "https://www.linkedin.com/in/person";
const account = { id: "account", name: "Main ID", company: "Silverspace", type: "main" as const, connectionLimit: 3, used: 1, remaining: 2, limit: 3 };
const bootstrap: ExtensionBootstrap = { user: { id: "agent", name: "Agent" }, today: "2026-10-16", accounts: [account] };
const initialCheck: ExtensionCheck = { ...account, user: bootstrap.user, today: bootstrap.today, account, targetUrl,
  state: "new", canRecord: true, revision: "revision", history: [], previousRequest: null };

function fixture() {
  let lock: TrackingLock | null = { origin, userId: "agent", accountId: "account" };
  let attempts: TrackingAttempt[] = [];
  let previews: TrackingPreview[] = [];
  let check = { ...initialCheck };
  let now = Date.parse("2026-10-16T15:00:00Z");
  const request = jest.fn(async (_origin: string, input?: ExtensionInput) => {
    if (input?.operation !== 'record') return input ? check : bootstrap;
    // The real record endpoint validates these before writing (covered by server tests).
    if (input.expectedUserId !== check.user.id) throw new Error('CRM user changed');
    if (input.revision !== check.revision || !check.canRecord) throw new Error('CRM history or allowance changed');
    return { ...check, mode: "created", state: "active_request", canRecord: false, used: 2, remaining: 1 };
  });
  const store = { lock: async () => lock, setLock: async (next: TrackingLock | null) => { lock = next; },
    attempts: async () => JSON.parse(JSON.stringify(attempts)), saveAttempts: async (next: TrackingAttempt[]) => { attempts = JSON.parse(JSON.stringify(next)); },
    previews: async () => JSON.parse(JSON.stringify(previews)), savePreviews: async (next: TrackingPreview[]) => { previews = JSON.parse(JSON.stringify(next)); } };
  const make = () => new PageTracking(store, request as TrackingRequest, () => now, () => "attempt-1");
  const tracking = make();
  const prepare = () => tracking.run(() => tracking.handle(origin, 7, { type: "page-prepare", targetUrl })) as Promise<PageStatus>;
  const sent = (tabId = 7, url = targetUrl) => tracking.run(() => tracking.handle(origin, tabId, { type: "page-sent", targetUrl: url, attemptId: "attempt-1" }));
  return { tracking, make, request, store, prepare, sent, attempts: () => attempts, lock: () => lock,
    setCheck: (next: Partial<ExtensionCheck>) => { check = { ...check, ...next }; }, advance: (ms = 120001) => { now += ms; }, setNow: (value: number) => { now = value; } };
}

it("requires an explicit lock, persists it, and retains the account at zero remaining", async () => {
  const f = fixture(); await f.tracking.configure(origin, null);
  await expect(f.prepare()).rejects.toThrow("lock the account");
  await f.tracking.configure(origin, "account");
  expect(f.lock()).toEqual({ origin, accountId: "account", userId: "agent" });
  f.setCheck({ state: "limit_reached", canRecord: false, remaining: 0 });
  expect(await f.tracking.handle(origin, 7, { type: "page-status", targetUrl })).toMatchObject({ check: { remaining: 0 } });
  await expect(f.prepare()).rejects.toThrow("limit reached");
  expect(f.lock()?.accountId).toBe("account");
});

it.each(["limit_reached", "missing_limit", "existing_lead", "active_request"] as const)("blocks %s before arming any invitation", async state => {
  const f = fixture(); f.setCheck({ state, canRecord: false });
  await expect(f.prepare()).rejects.toThrow();
  expect(f.attempts()).toEqual([]);
  expect(f.request.mock.calls.some(([, input]) => input?.operation === "record")).toBe(false);
});

it("serializes competing tabs and prohibits account changes during an invitation", async () => {
  const f = fixture();
  const results = await Promise.allSettled([f.prepare(), f.tracking.run(() => f.tracking.handle(origin, 8, { type: "page-prepare", targetUrl }))]);
  expect(results.map(item => item.status)).toEqual(["fulfilled", "rejected"]);
  await expect(f.tracking.configure(origin, null)).rejects.toThrow("pending invitation");
  expect(f.attempts()).toHaveLength(1);
});

it("rechecks quota before the final Send click", async () => {
  const f = fixture(); await f.prepare();
  f.setCheck({ state: "limit_reached", canRecord: false, remaining: 0 });
  await expect(f.tracking.handle(origin, 7, { type: "page-validate", targetUrl, attemptId: "attempt-1" })).rejects.toThrow("Sending is blocked");
  expect(f.request.mock.calls.some(([, input]) => input?.operation === "record")).toBe(false);
});

it("records a confirmed send once, bound to the original account and actor", async () => {
  const f = fixture(); await f.prepare();
  expect(await f.sent()).toMatchObject({ mode: "created", remaining: 1 });
  await expect(f.sent()).rejects.toThrow("No matching invitation");
  expect(f.request.mock.calls.filter(([, input]) => input?.operation === "record")).toEqual([[origin, {
    operation: "record", accountId: "account", targetUrl, revision: "revision", confirmResend: false, expectedUserId: "agent",
  }]]);
  expect(f.attempts()).toEqual([]);
});

it("does not turn an uncertain save response into an automatic retry, including after worker restart", async () => {
  const f = fixture(); await f.prepare();
  f.request.mockRejectedValueOnce(new Error("Response lost"));
  await expect(f.sent()).rejects.toThrow("Response lost");
  expect(f.attempts()[0].state).toBe("uncertain");
  await expect(f.make().handle(origin, 7, { type: "page-sent", targetUrl, attemptId: "attempt-1" })).rejects.toThrow("needs review");
  expect(f.request.mock.calls.filter(([, input]) => input?.operation === "record")).toHaveLength(1);
});

it("rejects a foreign tab/profile locally and a switched actor at the record endpoint before writing", async () => {
  const f = fixture(); await f.prepare();
  await expect(f.sent(8)).rejects.toThrow("No matching invitation");
  await expect(f.sent(7, "https://www.linkedin.com/in/someone-else")).rejects.toThrow("No matching invitation");
  f.setCheck({ user: { id: "other", name: "Other" } });
  await expect(f.sent()).rejects.toThrow("CRM user changed");
  expect(f.request.mock.calls.filter(([, input]) => input?.operation === "record")).toEqual([[origin, expect.objectContaining({ expectedUserId: 'agent' })]]);
});

it('saves with one validated record request instead of check followed by record', async () => {
  const f = fixture(); await f.prepare(); f.request.mockClear();
  await f.sent();
  expect(f.request.mock.calls).toEqual([[origin, expect.objectContaining({ operation: 'record', revision: 'revision', expectedUserId: 'agent' })]]);
});

it.each([{ accountId: 'other' }, { userId: 'other' }, { origin: 'https://other.example' }])('rejects a changed local lock before any save request: %o', async changed => {
  const f = fixture(); await f.prepare();
  await f.store.setLock({ ...f.lock()!, ...changed }); f.request.mockClear();
  await expect(f.sent()).rejects.toThrow('locked account changed');
  expect(f.request).not.toHaveBeenCalled();
});

it("requires an explicit resend confirmation", async () => {
  const f = fixture(); f.setCheck({ state: "resend_available" });
  await expect(f.prepare()).rejects.toThrow("Confirm");
  expect(await f.tracking.handle(origin, 7, { type: "page-prepare", targetUrl, confirmResend: true })).toMatchObject({ attempt: { confirmResend: true } });
});

it("cancels without a CRM write and retains expired attempts for review", async () => {
  const f = fixture(); await f.prepare(); f.advance();
  await expect(f.sent()).rejects.toThrow("needs review");
  expect(f.attempts()).toHaveLength(1);
  await f.tracking.handle(origin, 7, { type: "page-cancel", targetUrl, attemptId: "attempt-1" });
  expect(f.attempts()).toEqual([]);
  expect(f.request.mock.calls.some(([, input]) => input?.operation === "record")).toBe(false);
});

it("turns an interrupted saving state into reviewable uncertainty after worker restart", async () => {
  const f = fixture(); await f.prepare();
  await f.store.saveAttempts(f.attempts().map(item => ({ ...item, state: "saving" })));
  const restarted = f.make();
  await expect(restarted.handle(origin, 7, { type: "page-sent", targetUrl, attemptId: "attempt-1" })).rejects.toThrow("needs review");
  expect(f.attempts()[0].state).toBe("uncertain");
  await restarted.clearReviewed("attempt-1");
  expect(f.attempts()).toEqual([]);
});

it('recovers an expired armed attempt only on explicit confirmation with its original revision', async () => {
  const f = fixture(); await f.prepare();
  await expect(f.tracking.handle(origin, 7, { type: 'page-recover', targetUrl, attemptId: 'attempt-1' } as any)).rejects.toThrow('Confirm');
  f.advance();
  await expect(f.tracking.handle(origin, 7, { type: 'page-recover', targetUrl, attemptId: 'attempt-1' } as any)).rejects.toThrow('Confirm');
  expect(await f.tracking.handle(origin, 7, { type: 'page-recover', targetUrl, attemptId: 'attempt-1', confirmedPending: true })).toMatchObject({ mode: 'created' });
  expect(f.request.mock.calls.filter(([, input]) => input?.operation === 'record')).toHaveLength(1);
  expect(f.attempts()).toEqual([]);
});

it.each([
  { revision: 'another-date-or-history' }, { canRecord: false, state: 'active_request' },
  { canRecord: false, state: 'limit_reached' }, { user: { id: 'other', name: 'Other' } },
] as Partial<ExtensionCheck>[])('rejects recovery after the original CRM context changed: %o', async changed => {
  const f = fixture(); await f.prepare(); f.setCheck(changed);
  await expect(f.tracking.handle(origin, 7, { type: 'page-recover', targetUrl, attemptId: 'attempt-1', confirmedPending: true })).rejects.toThrow();
  expect(f.request.mock.calls.some(([, input]) => input?.operation === 'record')).toBe(false);
});

it.each(['uncertain', 'saving'] as const)('never recovers a %s write, even with explicit confirmation', async state => {
  const f = fixture(); await f.prepare();
  await f.store.saveAttempts(f.attempts().map(item => ({ ...item, state })));
  await expect(f.tracking.handle(origin, 7, { type: 'page-recover', targetUrl, attemptId: 'attempt-1', confirmedPending: true })).rejects.toThrow('needs review');
  expect(f.request.mock.calls.some(([, input]) => input?.operation === 'record')).toBe(false);
});

it('joins the in-flight availability request when Connect is clicked before it finishes', async () => {
  const f = fixture();
  let release!: (value: ExtensionCheck) => void;
  f.request.mockReturnValueOnce(new Promise(resolve => { release = resolve; }));
  const status = f.tracking.handle(origin, 7, { type: 'page-status', targetUrl });
  // Wait for the slow check to start before another operation prepares an attempt.
  while (!f.request.mock.calls.length) await Promise.resolve();
  const prepared = f.prepare(); release(initialCheck);
  await status;
  expect(await prepared).toMatchObject({ attempt: { id: 'attempt-1' } });
  expect(f.request.mock.calls.filter(([, input]) => input?.operation === 'check')).toHaveLength(1);
});

it('discards a status result if the lock changes during its network request', async () => {
  const f = fixture();
  let release!: (value: ExtensionCheck) => void;
  f.request.mockReturnValueOnce(new Promise(resolve => { release = resolve; }));
  const status = f.tracking.handle(origin, 7, { type: 'page-status', targetUrl });
  while (!f.request.mock.calls.length) await Promise.resolve();
  await f.store.setLock({ ...f.lock()!, accountId: 'other' }); release(initialCheck);
  await expect(status).rejects.toThrow('locked account changed');
});

it('uses the completed profile check for Connect without another CRM request, including worker suspension', async () => {
  const f = fixture();
  await f.tracking.handle(origin, 7, { type: 'page-status', targetUrl });
  f.advance(60_000); // Worker can have gone idle while the agent reads the profile.
  f.request.mockClear();
  expect(await f.make().handle(origin, 7, { type: 'page-prepare', targetUrl })).toMatchObject({ attempt: { revision: 'revision' } });
  expect(f.request).not.toHaveBeenCalled();
});

it('refreshes explicitly and expires an old preview instead of reusing it indefinitely', async () => {
  const f = fixture();
  await f.tracking.handle(origin, 7, { type: 'page-status', targetUrl });
  await f.tracking.handle(origin, 7, { type: 'page-status', targetUrl, fresh: true });
  expect(f.request).toHaveBeenCalledTimes(2);
  f.advance(300001); f.request.mockClear();
  await f.prepare();
  expect(f.request).toHaveBeenCalledTimes(1);
});

it.each([{ tab: 8, target: 'https://www.linkedin.com/in/another' }, { tab: 7, target: 'https://www.linkedin.com/in/another' }])('never reuses a different profile preview: %o', async next => {
  const f = fixture();
  await f.tracking.handle(origin, 7, { type: 'page-status', targetUrl }); f.request.mockClear();
  f.setCheck({ targetUrl: next.target });
  await f.tracking.handle(origin, next.tab, { type: 'page-prepare', targetUrl: next.target });
  expect(f.request).toHaveBeenCalledTimes(1);
});

it('does not reuse a preview after account selection changes or the Eastern business date rolls over', async () => {
  const f = fixture();
  f.setNow(Date.parse('2026-10-17T03:59:50Z'));
  await f.tracking.handle(origin, 7, { type: 'page-status', targetUrl }); f.request.mockClear();
  f.advance(20_000); f.setCheck({ today: '2026-10-17' });
  await f.prepare();
  expect(f.request).toHaveBeenCalledTimes(1);
  await f.tracking.handle(origin, 7, { type: 'page-cancel', targetUrl, attemptId: 'attempt-1' });
  await f.store.setLock({ ...f.lock()!, accountId: 'other-account' });
  f.setCheck({ account: { ...account, id: 'other-account' } }); f.request.mockClear();
  await f.prepare();
  expect(f.request).toHaveBeenCalledTimes(1);
});

it('invalidates preview receipts after a save or uncertain save outcome', async () => {
  const f = fixture();
  await f.tracking.handle(origin, 7, { type: 'page-status', targetUrl }); await f.prepare();
  expect(await f.store.previews()).toHaveLength(1);
  f.request.mockRejectedValueOnce(new Error('Response lost'));
  await expect(f.sent()).rejects.toThrow('Response lost');
  expect(await f.store.previews()).toEqual([]);
});

it('automatically checks each profile once and shares its saved result across tabs and worker restarts', async () => {
  const f = fixture();
  await f.tracking.handle(origin, 7, { type: 'page-status', targetUrl });
  const other = 'https://www.linkedin.com/in/other';
  f.setCheck({ targetUrl: other });
  await f.tracking.handle(origin, 8, { type: 'page-status', targetUrl: other });
  f.request.mockClear();
  const restarted = f.make();
  for (const [tabId, url] of [[7, targetUrl], [8, other], [9, targetUrl]] as const) {
    expect(await restarted.handle(origin, tabId, { type: 'page-status', targetUrl: url })).toMatchObject({ check: { targetUrl: url } });
  }
  expect(f.request).not.toHaveBeenCalled();
  expect(await f.store.previews()).toHaveLength(2);
});

it('joins simultaneous checks for the same profile in different tabs while keeping attempts tab-bound', async () => {
  const f = fixture();
  let release!: (value: ExtensionCheck) => void;
  f.request.mockReturnValueOnce(new Promise(resolve => { release = resolve; }));
  const first = f.tracking.handle(origin, 7, { type: 'page-status', targetUrl });
  while (!f.request.mock.calls.length) await Promise.resolve();
  const second = f.tracking.handle(origin, 8, { type: 'page-status', targetUrl });
  release(initialCheck);
  await Promise.all([first, second]);
  await f.prepare();
  expect(f.request).toHaveBeenCalledTimes(1);
  await expect(f.sent(8)).rejects.toThrow('No matching invitation');
  expect(f.attempts()[0].tabId).toBe(7);
});

it('invalidates every tab after a successful save and never returns the old allowance on the next visit', async () => {
  const f = fixture();
  await f.tracking.handle(origin, 8, { type: 'page-status', targetUrl });
  await f.prepare();
  await f.sent();
  f.setCheck({ state: 'active_request', canRecord: false, used: 2, remaining: 1 });
  f.request.mockClear();
  expect(await f.tracking.handle(origin, 8, { type: 'page-status', targetUrl }))
    .toMatchObject({ check: { state: 'active_request', remaining: 1 } });
  expect(f.request).toHaveBeenCalledTimes(1);
});

it('rejects a late check after CRM navigation or a save invalidates it, including persisted results', async () => {
  const f = fixture();
  let release!: (value: ExtensionCheck) => void;
  f.request.mockReturnValueOnce(new Promise(resolve => { release = resolve; }));
  const old = f.tracking.handle(origin, 7, { type: 'page-status', targetUrl });
  const rejected = expect(old).rejects.toThrow('CRM context changed');
  while (!f.request.mock.calls.length) await Promise.resolve();
  await f.tracking.invalidate(origin);
  await f.tracking.handle(origin, 8, { type: 'page-status', targetUrl });
  release(initialCheck); await rejected;
  expect(f.request).toHaveBeenCalledTimes(2);
  expect(await f.store.previews()).toHaveLength(1);
});

it('does not cache a failed background check', async () => {
  const f = fixture();
  f.request.mockRejectedValueOnce(new Error('Offline'));
  await expect(f.tracking.handle(origin, 7, { type: 'page-status', targetUrl })).rejects.toThrow('Offline');
  expect(await f.store.previews()).toEqual([]);
  await f.tracking.handle(origin, 8, { type: 'page-status', targetUrl });
  expect(f.request).toHaveBeenCalledTimes(2);
});

it('bounds stored previews to the most recently used 100 profiles', async () => {
  const f = fixture();
  f.request.mockImplementation(async (_origin, input) => ({ ...initialCheck, targetUrl: input!.targetUrl }));
  for (let index = 0; index < 110; index++) {
    await f.tracking.handle(origin, index, { type: 'page-status', targetUrl: `https://www.linkedin.com/in/person-${index}` });
  }
  expect(await f.store.previews()).toHaveLength(100);
  f.request.mockClear();
  const restarted = f.make();
  await restarted.handle(origin, 7, { type: 'page-status', targetUrl: 'https://www.linkedin.com/in/person-109' });
  expect(f.request).not.toHaveBeenCalled();
  await restarted.handle(origin, 7, { type: 'page-status', targetUrl: 'https://www.linkedin.com/in/person-0' });
  expect(f.request).toHaveBeenCalledTimes(1);
});
