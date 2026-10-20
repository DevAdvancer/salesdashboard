// The extension has its own React dependency; use the renderer's instance in Jest.
jest.mock("@/extensions/linkedin-helper/node_modules/react", () => jest.requireActual("react"));
jest.mock("wxt/browser", () => ({ browser: { storage: { local: { get: jest.fn() } }, tabs: { get: jest.fn(),
  onActivated: { addListener: jest.fn(), removeListener: jest.fn() },
  onUpdated: { addListener: jest.fn(), removeListener: jest.fn() },
} } }), { virtual: true });
jest.mock("crm-shared/utils/linkedin-extension-url", () => jest.requireActual("@/lib/utils/linkedin-extension-url"), { virtual: true });
jest.mock("@/extensions/linkedin-helper/lib/crm-client", () => ({
  BridgeError: class extends Error { constructor(message: string, public status?: number) { super(message); } },
  detectProfile: jest.fn(), loadConnection: jest.fn(), requestCrm: jest.fn(), rememberAccount: jest.fn(), sendBridge: jest.fn(),
  rememberedProfile: jest.fn(), rememberProfile: jest.fn(),
}));
jest.mock("@/extensions/linkedin-helper/lib/use-page-theme", () => ({ usePageTheme: jest.fn() }));

import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { browser } from "wxt/browser";
import { BridgeError, detectProfile, loadConnection, rememberedProfile, rememberProfile, requestCrm, sendBridge } from "@/extensions/linkedin-helper/lib/crm-client";
import { useLinkedinHelper } from "@/extensions/linkedin-helper/lib/use-linkedin-helper";
import { App } from "@/extensions/linkedin-helper/entrypoints/popup/App";
import type { ExtensionBootstrap, ExtensionCheck } from "@/lib/types/linkedin-extension";

const bootstrap: ExtensionBootstrap = { user: { id: "agent", name: "Agent" }, today: "2026-10-16",
  accounts: [{ id: "account", name: "Account", company: "Silverspace", type: "main", connectionLimit: 100, used: 42, limit: 100, remaining: 58 }] };
const checked: ExtensionCheck = { user: bootstrap.user, today: bootstrap.today, account: bootstrap.accounts[0], targetUrl: "https://www.linkedin.com/in/person",
  state: "new", canRecord: true, revision: "revision", history: [], previousRequest: null, used: 42, limit: 100, remaining: 58 };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}
beforeEach(() => {
  jest.clearAllMocks();
  (browser.storage.local.get as jest.Mock).mockResolvedValue({ crmOrigin: "http://localhost:5000" });
  (detectProfile as jest.Mock).mockResolvedValue({ url: checked.targetUrl, tabId: 7 });
  (loadConnection as jest.Mock).mockResolvedValue({ data: bootstrap, selectedAccountId: "account", note: "", locked: false, attempts: [] });
  (rememberedProfile as jest.Mock).mockResolvedValue("");
  (rememberProfile as jest.Mock).mockResolvedValue(undefined);
  (requestCrm as jest.Mock).mockResolvedValue(checked);
  (sendBridge as jest.Mock).mockResolvedValue(undefined);
});

it("automatically checks the current profile without requesting history or writing a request", async () => {
  const { result } = renderHook(() => useLinkedinHelper());
  await waitFor(() => expect(result.current.state.connection).toBe("connected"));
  await waitFor(() => expect(result.current.state.checked).toEqual(checked));
  expect((requestCrm as jest.Mock).mock.calls.every(([input]) => input.operation === 'check')).toBe(true);
  expect(requestCrm).toHaveBeenCalledWith({ operation: 'check', accountId: 'account', targetUrl: checked.targetUrl }, false);
  await act(async () => { result.current.check(); });
  expect(requestCrm).toHaveBeenCalledWith({ operation: "check", accountId: "account", targetUrl: checked.targetUrl }, true);
  expect(result.current.state.checked).toEqual(checked);
  expect(result.current).not.toHaveProperty("record");
  expect(result.current).not.toHaveProperty("history");
});

it('follows LinkedIn navigation and clears the old result before checking the new profile', async () => {
  const next = { ...checked, targetUrl: 'https://www.linkedin.com/in/next-person', state: 'existing_lead', canRecord: false };
  const { result } = renderHook(() => useLinkedinHelper());
  await waitFor(() => expect(result.current.state.checked).toEqual(checked));
  (detectProfile as jest.Mock).mockResolvedValue({ url: next.targetUrl, tabId: 7 });
  (requestCrm as jest.Mock).mockResolvedValue(next);
  await act(async () => {
    const update = (browser.tabs.onUpdated.addListener as jest.Mock).mock.calls[0][0];
    update(7, { url: next.targetUrl });
  });
  expect(result.current.state.profile).toBe(next.targetUrl);
  expect(result.current.state.checked).toBeNull();
  await waitFor(() => expect(result.current.state.checked).toEqual(next));
});

it('ignores an old profile response after another tab becomes active', async () => {
  const old = deferred<ExtensionCheck>();
  (requestCrm as jest.Mock).mockReturnValueOnce(old.promise);
  const next = { ...checked, targetUrl: 'https://www.linkedin.com/in/next-person' };
  const { result } = renderHook(() => useLinkedinHelper());
  await waitFor(() => expect(requestCrm).toHaveBeenCalled());
  (detectProfile as jest.Mock).mockResolvedValue({ url: next.targetUrl, tabId: 8 });
  (requestCrm as jest.Mock).mockResolvedValue(next);
  await act(async () => (browser.tabs.onActivated.addListener as jest.Mock).mock.calls[0][0]({ tabId: 8 }));
  await waitFor(() => expect(result.current.state.checked).toEqual(next));
  await act(async () => old.resolve(checked));
  expect(result.current.state.checked).toEqual(next);
});

it('clears the previous profile on navigation away from LinkedIn', async () => {
  const { result } = renderHook(() => useLinkedinHelper());
  await waitFor(() => expect(result.current.state.checked).toEqual(checked));
  (detectProfile as jest.Mock).mockRejectedValue(new Error('Not a profile'));
  await act(async () => (browser.tabs.onActivated.addListener as jest.Mock).mock.calls[0][0]({ tabId: 8 }));
  expect(result.current.state.profile).toBe('');
  expect(result.current.state.checked).toBeNull();
});

it('detects profile changes through polling when the browser emits no navigation event', async () => {
  jest.useFakeTimers();
  try {
    const { result, unmount } = renderHook(() => useLinkedinHelper());
    await act(async () => {});
    await act(async () => { await jest.advanceTimersByTimeAsync(300); });
    expect(result.current.state.checked).toEqual(checked);
    const next = { ...checked, targetUrl: 'https://www.linkedin.com/in/next-person' };
    (detectProfile as jest.Mock).mockResolvedValue({ url: next.targetUrl, tabId: 7 });
    (requestCrm as jest.Mock).mockResolvedValue(next);
    await act(async () => { await jest.advanceTimersByTimeAsync(1000); });
    await act(async () => { await jest.advanceTimersByTimeAsync(300); });
    expect(result.current.state.profile).toBe(next.targetUrl);
    expect(result.current.state.checked).toEqual(next);
    unmount();
  } finally { jest.useRealTimers(); }
});

it('does not label an existing request as a newly sent invitation after locking the account', async () => {
  (requestCrm as jest.Mock).mockResolvedValue({ ...checked, state: 'active_request', canRecord: false });
  render(<App />);
  await screen.findByText('Already sent');
  fireEvent.click(screen.getByRole('button', { name: 'Lock account for this browser profile' }));
  await screen.findByText(/Account locked for this browser profile/);
  expect(screen.getByText('Already sent')).toBeInTheDocument();
  expect(screen.queryByText('Sent', { exact: true })).not.toBeInTheDocument();
});

it("connects before slow LinkedIn detection completes", async () => {
  const detection = deferred<{ url: string; tabId: number }>();
  (detectProfile as jest.Mock).mockReturnValue(detection.promise);
  const { result } = renderHook(() => useLinkedinHelper());
  await waitFor(() => expect(result.current.state).toMatchObject({ connection: "connected", pending: false }));
  await act(async () => { detection.resolve({ url: checked.targetUrl, tabId: 7 }); });
  expect(result.current.state.profile).toBe(checked.targetUrl);
});

it("keeps the account connection after a failed status check and allows retry", async () => {
  (requestCrm as jest.Mock).mockRejectedValueOnce(new BridgeError("CRM timed out", 503)).mockResolvedValueOnce(checked);
  const { result } = renderHook(() => useLinkedinHelper());
  await waitFor(() => expect(result.current.state.pending).toBe(false));
  await act(async () => { result.current.check(); });
  expect(result.current.state).toMatchObject({ connection: "connected", checked: null, note: "CRM timed out", noteKind: "error" });
  await act(async () => { result.current.check(); });
  expect(result.current.state.checked).toEqual(checked);
});

it.each([401, 403])("disconnects on an authentication rejection (%s)", async status => {
  (requestCrm as jest.Mock).mockRejectedValue(new BridgeError("Sign in again", status));
  const { result } = renderHook(() => useLinkedinHelper());
  await waitFor(() => expect(result.current.state.pending).toBe(false));
  await act(async () => { result.current.check(); });
  expect(result.current.state).toMatchObject({ connection: "disconnected", checked: null });
});

it("rejects a result for a different CRM user", async () => {
  (requestCrm as jest.Mock).mockResolvedValue({ ...checked, user: { id: "other", name: "Other" } });
  const { result } = renderHook(() => useLinkedinHelper());
  await waitFor(() => expect(result.current.state.pending).toBe(false));
  await act(async () => { result.current.check(); });
  expect(result.current.state).toMatchObject({ connection: "disconnected", checked: null });
});

it("retains a remembered profile when there is no active LinkedIn profile", async () => {
  (detectProfile as jest.Mock).mockRejectedValue(new Error("No profile"));
  (rememberedProfile as jest.Mock).mockResolvedValue(checked.targetUrl);
  const { result } = renderHook(() => useLinkedinHelper());
  await waitFor(() => expect(result.current.state.profile).toBe(checked.targetUrl));
  expect(requestCrm).not.toHaveBeenCalled();
});

it("requires an unlock before account switching", async () => {
  (loadConnection as jest.Mock).mockResolvedValue({ data: bootstrap, selectedAccountId: "account", note: "", locked: true, attempts: [] });
  const { result } = renderHook(() => useLinkedinHelper());
  await waitFor(() => expect(result.current.state.pending).toBe(false));
  await act(async () => { result.current.selectAccount("other"); });
  expect(result.current.state.accountId).toBe("account");
  expect(result.current.state.note).toContain("Unlock");
  await act(async () => { result.current.unlockAccount(); });
  expect(sendBridge).toHaveBeenCalledWith({ type: "tracking-config", accountId: null });
  expect(result.current.state.locked).toBe(false);
});

it("removes all extension history and manual recording controls", async () => {
  render(<App />);
  await screen.findByRole("button", { name: "Lock account for this browser profile" });
  expect(screen.queryByText(/View history|Connection history|Record request sent|Record resend/)).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Check send status" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Lock account for this browser profile" }));
  await waitFor(() => expect(sendBridge).toHaveBeenCalledWith({ type: "tracking-config", accountId: "account" }));
});
