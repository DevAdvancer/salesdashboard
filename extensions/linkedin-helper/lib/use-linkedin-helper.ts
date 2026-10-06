import { useCallback, useEffect, useRef, useState } from "react";
import { browser } from "wxt/browser";
import { crmPermissionPattern, normalizeCrmOrigin, normalizeProfileUrl } from "crm-shared/utils/linkedin-extension-url";
import type { ExtensionBootstrap, ExtensionCheck, ExtensionRecord } from "crm-shared/types/linkedin-extension";
import { BridgeError, detectProfile, loadConnection, rememberAccount, rememberedProfile, rememberProfile, requestCrm, sendBridge } from "./crm-client";

interface HelperState {
  crmUrl: string; origin: string | null; connection: "disconnected" | "connecting" | "connected";
  bootstrap: ExtensionBootstrap | null; accountId: string; profile: string; checked: ExtensionCheck | null;
  confirmResend: boolean; historyVisible: boolean; pending: boolean; note: string; noteKind: "info" | "error" | "success";
}
const initial: HelperState = { crmUrl: "https://crm.silverspaceinc.tech", origin: null, connection: "disconnected",
  bootstrap: null, accountId: "", profile: "", checked: null, confirmResend: false, historyVisible: false, pending: true, note: "", noteKind: "info" };

function withResult(state: HelperState, data: ExtensionCheck): HelperState {
  return { ...state, profile: data.targetUrl, checked: data, confirmResend: false,
    bootstrap: state.bootstrap ? { ...state.bootstrap, today: data.today,
      accounts: state.bootstrap.accounts.map(account => account.id === data.account.id ?
        { ...account, used: data.used, limit: data.limit, remaining: data.remaining } : account) } : null };
}

export function useLinkedinHelper() {
  const [state, setState] = useState<HelperState>(initial);
  const generation = useRef(0);
  const running = useRef(true);
  const profileTab = useRef<number | null>(null);
  const mounted = useRef(true);

  const invalidate = useCallback(() => {
    generation.current++;
    setState(previous => ({ ...previous, checked: null, confirmResend: false, historyVisible: false, note: "" }));
  }, []);

  const checkProfile = useCallback(async (accountId: string, rawUrl: string, userId: string, fresh = false, history = false) => {
    invalidate();
    if (!accountId) throw new Error("Choose an assigned LinkedIn account first.");
    const targetUrl = normalizeProfileUrl(rawUrl);
    const version = generation.current;
    setState(previous => ({ ...previous, note: history ? "Loading history…" : "Checking availability…" }));
    const data = await requestCrm<ExtensionCheck>({ operation: history ? "history" : "check", accountId, targetUrl }, fresh);
    if (data.user.id !== userId) throw new BridgeError("The signed-in CRM user changed. Refresh accounts before continuing.", 401);
    if (mounted.current && version === generation.current) setState(previous => withResult({ ...previous, note: "", historyVisible: history }, data));
  }, [invalidate]);

  useEffect(() => {
    let cancelled = false;
    mounted.current = true;
    const version = generation.current;
    async function initialize() {
      const stored = await browser.storage.local.get("crmOrigin");
      const origin = stored.crmOrigin ? normalizeCrmOrigin(stored.crmOrigin) : null;
      let detected = "";
      try { const profile = await detectProfile(); detected = profile.url; profileTab.current = profile.tabId; } catch { /* Manual entry is available. */ }
      if (cancelled) return;
      setState(previous => ({ ...previous, crmUrl: origin || initial.crmUrl, origin, profile: detected,
        connection: origin ? "connecting" : "disconnected" }));
      if (!origin) return;
      const loaded = await loadConnection(origin);
      const profile = detected || await rememberedProfile(origin, loaded.data.user.id);
      if (cancelled || version !== generation.current) return;
      // Account loading establishes the connection; history can take longer on LinkedIn.
      setState(previous => ({ ...previous, bootstrap: loaded.data, accountId: loaded.selectedAccountId, profile,
        connection: "connected", note: loaded.note }));
    }
    initialize().catch((error: unknown) => {
      if (!cancelled) setState(previous => ({ ...previous, connection: connectionAfterError(previous.connection, error), checked: null,
        note: error instanceof Error ? error.message : "Could not connect to CRM.", noteKind: "error" }));
    }).finally(() => {
      if (!cancelled) { running.current = false; setState(previous => ({ ...previous, pending: false })); }
    });
    return () => { cancelled = true; mounted.current = false; };
  }, [checkProfile]);

  const userId = state.bootstrap?.user.id;
  useEffect(() => {
    if (state.connection === "connected" && state.origin && userId) {
      void rememberProfile(state.origin, userId, state.profile).catch(() => { /* Profile restoration is optional. */ });
    }
  }, [state.connection, state.origin, state.profile, userId]);

  async function perform(task: () => Promise<void>) {
    if (running.current) return;
    running.current = true;
    setState(previous => ({ ...previous, pending: true, note: "", noteKind: "info" }));
    try { await task(); } catch (error) {
      generation.current++;
      if (mounted.current) setState(previous => ({ ...previous, checked: null, confirmResend: false,
        connection: connectionAfterError(previous.connection, error),
        note: error instanceof Error ? error.message : "Something went wrong. Retry.", noteKind: "error" }));
    } finally {
      running.current = false;
      if (mounted.current) setState(previous => ({ ...previous, pending: false }));
    }
  }

  async function refreshConnection(origin: string) {
    invalidate();
    setState(previous => ({ ...previous, connection: "connecting" }));
    const loaded = await loadConnection(origin, true);
    if (!mounted.current) return;
    setState(previous => ({ ...previous, bootstrap: loaded.data, accountId: loaded.selectedAccountId,
      connection: "connected", note: loaded.note, origin }));
  }

  function connect() {
    // perform starts the permission request synchronously in the click gesture.
    void perform(async () => {
      const origin = normalizeCrmOrigin(state.crmUrl);
      const allowed = await browser.permissions.request({ origins: [crmPermissionPattern(origin)] });
      if (!allowed) throw new Error("CRM hostname access is required to connect.");
      await browser.storage.local.set({ crmOrigin: origin });
      setState(previous => ({ ...previous, crmUrl: origin, origin }));
      await sendBridge({ type: "ensure-crm" });
      await refreshConnection(origin);
    });
  }

  return { state,
    setCrmUrl(crmUrl: string) { invalidate(); setState(previous => ({ ...previous, crmUrl, connection: "disconnected" })); },
    setProfile(profile: string) { profileTab.current = null; invalidate(); setState(previous => ({ ...previous, profile })); },
    setConfirmResend(confirmResend: boolean) { setState(previous => ({ ...previous, confirmResend })); },
    connect,
    refresh() { void perform(() => refreshConnection(normalizeCrmOrigin(state.origin))); },
    check() { void perform(() => checkProfile(state.accountId, state.profile, state.bootstrap?.user.id || "", true)); },
    history() { void perform(() => checkProfile(state.accountId, state.profile, state.bootstrap?.user.id || "", true, true)); },
    detect() { void perform(async () => {
      invalidate();
      const detected = await detectProfile(); profileTab.current = detected.tabId;
      setState(previous => ({ ...previous, profile: detected.url }));
    }); },
    selectAccount(accountId: string) { void perform(async () => {
      invalidate(); setState(previous => ({ ...previous, accountId }));
      if (!state.origin || !state.bootstrap) return;
      await rememberAccount(state.origin, state.bootstrap.user.id, accountId);
    }); },
    record() { void perform(async () => {
      const checked = state.checked;
      if (!state.accountId) throw new Error("Choose an assigned LinkedIn account first.");
      const targetUrl = normalizeProfileUrl(state.profile);
      if (checked && !checked.canRecord) throw new Error("This profile is already recorded or unavailable.");
      if (checked?.state === "resend_available" && !state.confirmResend) throw new Error("Confirm the resend first.");
      if (profileTab.current !== null) {
        const tab = await browser.tabs.get(profileTab.current);
        if (normalizeProfileUrl(tab.url) !== targetUrl) throw new Error("The LinkedIn profile changed. Detect it again.");
      }
      setState(previous => ({ ...previous, note: "Checking duplicates and recording…", noteKind: "info" }));
      const data = await requestCrm<ExtensionRecord>({ operation: "record", accountId: state.accountId,
        targetUrl, ...(checked ? { revision: checked.revision } : {}), confirmResend: state.confirmResend });
      if (data.user.id !== state.bootstrap?.user.id) throw new Error("The signed-in CRM user changed. Refresh accounts before continuing.");
      if (mounted.current) setState(previous => ({ ...withResult(previous, data), historyVisible: false,
        note: data.mode === "existing" ? "No request added. Review the profile status." :
          `${data.mode === "resent" ? "Resend" : "Request"} recorded · ${data.remaining ?? "?"} remaining.`,
        noteKind: data.mode === "existing" ? "info" : "success" }));
    }); },
    openCrm() { void perform(async () => { await sendBridge({ type: "open-crm" }); }); },
  };
}

function connectionAfterError(connection: HelperState["connection"], error: unknown): HelperState["connection"] {
  return connection === "connecting" || (error instanceof BridgeError && (error.status === 401 || error.status === 403))
    ? "disconnected" : connection;
}
