// The extension has its own dependencies; use the renderer's React instance in Jest.
jest.mock("@/extensions/linkedin-helper/node_modules/react", () => jest.requireActual("react"));
jest.mock("wxt/browser", () => ({ browser: { storage: { local: { get: jest.fn() } }, tabs: { get: jest.fn() } } }), { virtual: true });
jest.mock("crm-shared/utils/linkedin-extension-url", () => jest.requireActual("@/lib/utils/linkedin-extension-url"), { virtual: true });
jest.mock("@/extensions/linkedin-helper/lib/crm-client", () => ({
  BridgeError: class extends Error { constructor(message: string, public status?: number) { super(message); } },
  detectProfile: jest.fn(), loadConnection: jest.fn(), requestCrm: jest.fn(), rememberAccount: jest.fn(), sendBridge: jest.fn(),
  rememberedProfile: jest.fn(), rememberProfile: jest.fn(),
}));

import { act, renderHook, waitFor } from "@testing-library/react";
import { browser } from "wxt/browser";
import { BridgeError, detectProfile, loadConnection, rememberedProfile, rememberProfile, requestCrm } from "@/extensions/linkedin-helper/lib/crm-client";
import { useLinkedinHelper } from "@/extensions/linkedin-helper/lib/use-linkedin-helper";
import type { ExtensionBootstrap, ExtensionCheck } from "@/lib/types/linkedin-extension";

const bootstrap: ExtensionBootstrap = {
  user: { id: "agent", name: "Agent" }, today: "2026-10-06",
  accounts: [{ id: "account", name: "Account", company: "Silverspace", type: "main", connectionLimit: 100, used: 42, limit: 100, remaining: 58 }],
};
const checked: ExtensionCheck = {
  user: bootstrap.user, today: bootstrap.today, account: bootstrap.accounts[0], targetUrl: "https://www.linkedin.com/in/person",
  state: "new", canRecord: true, revision: "revision", history: [], used: 42, limit: 100, remaining: 58,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

beforeEach(() => {
  jest.clearAllMocks();
  (browser.storage.local.get as jest.Mock).mockResolvedValue({ crmOrigin: "http://localhost:5000" });
  (detectProfile as jest.Mock).mockResolvedValue({ url: checked.targetUrl, tabId: 7 });
  (loadConnection as jest.Mock).mockResolvedValue({ data: bootstrap, selectedAccountId: "account", note: "" });
  (rememberedProfile as jest.Mock).mockResolvedValue("");
  (rememberProfile as jest.Mock).mockResolvedValue(undefined);
  (browser.tabs.get as jest.Mock).mockResolvedValue({ url: checked.targetUrl });
});

it("shows connected accounts while a LinkedIn history check is still pending", async () => {
  const check = deferred<ExtensionCheck>();
  (requestCrm as jest.Mock).mockReturnValue(check.promise);
  const { result } = renderHook(() => useLinkedinHelper());
  await waitFor(() => expect(result.current.state.connection).toBe("connected"));
  expect(requestCrm).not.toHaveBeenCalled();
  act(() => { result.current.history(); });
  expect(result.current.state).toMatchObject({ bootstrap, accountId: "account", pending: true, checked: null, note: "Loading history…" });
  await act(async () => { check.resolve(checked); });
  expect(result.current.state).toMatchObject({ connection: "connected", pending: false, checked, note: "" });
});

it("keeps the account connection and allows retry after a failed history lookup", async () => {
  (requestCrm as jest.Mock).mockRejectedValueOnce(new BridgeError("History timed out", 503)).mockResolvedValueOnce(checked);
  const { result } = renderHook(() => useLinkedinHelper());
  await waitFor(() => expect(result.current.state.pending).toBe(false));
  await act(async () => { result.current.history(); });
  expect(result.current.state).toMatchObject({ connection: "connected", checked: null, note: "History timed out", noteKind: "error" });
  await act(async () => { result.current.check(); });
  expect(result.current.state).toMatchObject({ connection: "connected", checked, pending: false });
});

it.each([401, 403])("disconnects if the history check rejects authentication with %s", async status => {
  (requestCrm as jest.Mock).mockRejectedValue(new BridgeError("Sign in again", status));
  const { result } = renderHook(() => useLinkedinHelper());
  await waitFor(() => expect(result.current.state.pending).toBe(false));
  await act(async () => { result.current.history(); });
  expect(result.current.state).toMatchObject({ connection: "disconnected", checked: null });
});

it("rejects history for a different signed-in CRM user", async () => {
  (requestCrm as jest.Mock).mockResolvedValue({ ...checked, user: { id: "other", name: "Other" } });
  const { result } = renderHook(() => useLinkedinHelper());
  await waitFor(() => expect(result.current.state.pending).toBe(false));
  await act(async () => { result.current.history(); });
  expect(result.current.state).toMatchObject({ connection: "disconnected", checked: null, noteKind: "error" });
});

it("does not check a profile when opened on a CRM tab", async () => {
  (detectProfile as jest.Mock).mockRejectedValue(new Error("No profile"));
  const { result } = renderHook(() => useLinkedinHelper());
  await waitFor(() => expect(result.current.state.pending).toBe(false));
  expect(result.current.state.connection).toBe("connected");
  expect(requestCrm).not.toHaveBeenCalled();
});

it("ignores a history response after the popup closes", async () => {
  const check = deferred<ExtensionCheck>();
  (requestCrm as jest.Mock).mockReturnValue(check.promise);
  const { result, unmount } = renderHook(() => useLinkedinHelper());
  await waitFor(() => expect(result.current.state.connection).toBe("connected"));
  act(() => { result.current.history(); });
  unmount();
  await act(async () => { check.resolve(checked); });
  expect(result.current.state.checked).toBeNull();
});

it("restores a manually entered profile on reopening when there is no active LinkedIn profile", async () => {
  (detectProfile as jest.Mock).mockRejectedValue(new Error("No profile"));
  (rememberedProfile as jest.Mock).mockResolvedValue(checked.targetUrl);
  (requestCrm as jest.Mock).mockResolvedValue(checked);
  const { result } = renderHook(() => useLinkedinHelper());
  await waitFor(() => expect(result.current.state.pending).toBe(false));
  expect(result.current.state).toMatchObject({ profile: checked.targetUrl, checked: null, connection: "connected" });
  expect(rememberedProfile).toHaveBeenCalledWith("http://localhost:5000", bootstrap.user.id);
});

it("records directly without an initial history request", async () => {
  (requestCrm as jest.Mock).mockResolvedValue({ ...checked, state: "active_request", canRecord: false, mode: "created", remaining: 57 });
  const { result } = renderHook(() => useLinkedinHelper());
  await waitFor(() => expect(result.current.state.pending).toBe(false));
  expect(requestCrm).not.toHaveBeenCalled();
  await act(async () => { result.current.record(); });
  expect(requestCrm).toHaveBeenCalledTimes(1);
  expect(requestCrm).toHaveBeenCalledWith({ operation: "record", accountId: "account", targetUrl: checked.targetUrl, confirmResend: false });
  expect(result.current.state).toMatchObject({ historyVisible: false, noteKind: "success" });
});
