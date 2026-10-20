import { useCallback, useEffect, useRef, useState } from "react";
import { browser } from "wxt/browser";
import { crmPermissionPattern, normalizeCrmOrigin, normalizeProfileUrl } from "crm-shared/utils/linkedin-extension-url";
import type { ExtensionBootstrap, ExtensionCheck } from "crm-shared/types/linkedin-extension";
import { BridgeError, detectProfile, loadConnection, rememberAccount, rememberedProfile, rememberProfile, requestCrm, sendBridge } from "./crm-client";
import type { TrackingAttempt } from "./page-tracking";

interface HelperState {
  crmUrl: string; origin: string | null; connection: "disconnected" | "connecting" | "connected";
  bootstrap: ExtensionBootstrap | null; accountId: string; profile: string; checked: ExtensionCheck | null;
  pending: boolean; note: string; noteKind: "info" | "error" | "success";
  locked: boolean; attempts: TrackingAttempt[];
}
const initial: HelperState = { crmUrl: "https://crm.silverspaceinc.tech", origin: null, connection: "disconnected",
  bootstrap: null, accountId: "", profile: "", checked: null, pending: true, note: "", noteKind: "info", locked: false, attempts: [] };

function withResult(state: HelperState, data: ExtensionCheck): HelperState {
  return { ...state, profile: data.targetUrl, checked: data,
    bootstrap: state.bootstrap ? { ...state.bootstrap, today: data.today,
      accounts: state.bootstrap.accounts.map(account => account.id === data.account.id ?
        { ...account, used: data.used, limit: data.limit, remaining: data.remaining } : account) } : null };
}

export function useLinkedinHelper() {
  const [state, setState] = useState<HelperState>(initial);
  const generation = useRef(0);
  const running = useRef(true);
  const mounted = useRef(true);
  const activeProfile = useRef('');
  const detectionGeneration = useRef(0);

  const invalidate = useCallback(() => {
    generation.current++;
    setState(previous => ({ ...previous, checked: null, note: "", noteKind: 'info' }));
  }, []);

  const checkProfile = useCallback(async (accountId: string, rawUrl: string, userId: string, fresh = false) => {
    invalidate();
    if (!accountId) throw new Error("Choose an assigned LinkedIn account first.");
    const targetUrl = normalizeProfileUrl(rawUrl);
    const version = generation.current;
    setState(previous => ({ ...previous, note: "Checking availability…" }));
    let data: ExtensionCheck;
    try { data = await requestCrm<ExtensionCheck>({ operation: "check", accountId, targetUrl }, fresh); }
    catch (error) { if (!mounted.current || version !== generation.current) return; throw error; }
    if (!mounted.current || version !== generation.current) return;
    if (data.user.id !== userId) throw new BridgeError("The signed-in CRM user changed. Refresh accounts before continuing.", 401);
    if (data.targetUrl !== targetUrl) throw new Error('The profile changed during the check. Detect the current profile and retry.');
    if (mounted.current && version === generation.current) setState(previous => withResult({ ...previous, note: "" }, data));
  }, [invalidate]);

  useEffect(() => {
    let cancelled = false;
    mounted.current = true;
    const version = generation.current;
    async function initialize() {
      const stored = await browser.storage.local.get("crmOrigin");
      const origin = stored.crmOrigin ? normalizeCrmOrigin(stored.crmOrigin) : null;
      if (cancelled) return;
      setState(previous => ({ ...previous, crmUrl: origin || initial.crmUrl, origin,
        connection: origin ? "connecting" : "disconnected" }));
      // Profile detection can be slow on LinkedIn. It must not hold up the CRM connection.
      const detection = ++detectionGeneration.current;
      const detecting = detectProfile().then(profile => {
        if (cancelled || version !== generation.current || detection !== detectionGeneration.current) return "";
        activeProfile.current = profile.url;
        setState(previous => ({ ...previous, profile: profile.url }));
        return profile.url;
      }).catch(() => "");
      if (!origin) return;
      const loaded = await loadConnection(origin);
      if (cancelled || version !== generation.current) return;
      setState(previous => ({ ...previous, bootstrap: loaded.data, accountId: loaded.selectedAccountId,
        connection: "connected", note: loaded.note, locked: loaded.locked || false, attempts: loaded.attempts || [] }));
      void detecting.then(async detected => {
        if (detected) return;
        const profile = await rememberedProfile(origin, loaded.data.user.id);
        if (!cancelled && version === generation.current) setState(previous => ({ ...previous, profile: previous.profile || profile }));
      }).catch(() => { /* Profile restoration is optional. */ });
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

  useEffect(() => {
    if (state.connection !== 'connected') return;
    let cancelled = false;
    const sync = async () => {
      const version = ++detectionGeneration.current;
      const url = await detectProfile().then(profile => profile.url).catch(() => '');
      if (cancelled || !mounted.current || version !== detectionGeneration.current || url === activeProfile.current) return;
      activeProfile.current = url;
      invalidate();
      setState(previous => ({ ...previous, profile: url }));
    };
    const changed = () => { void sync(); };
    const updated = (_tabId: number, change: { url?: string; status?: string }) => {
      if (change.url || change.status === 'complete') changed();
    };
    browser.tabs.onActivated.addListener(changed);
    browser.tabs.onUpdated.addListener(updated);
    const timer = window.setInterval(changed, 1000);
    // Also catches an active-tab change while the popup was connecting.
    changed();
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      browser.tabs.onActivated.removeListener(changed);
      browser.tabs.onUpdated.removeListener(updated);
    };
  }, [state.connection, invalidate]);

  useEffect(() => {
    if (state.connection !== 'connected' || !state.accountId || !state.profile || !userId) return;
    try { normalizeProfileUrl(state.profile); } catch { return; }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      const task = checkProfile(state.accountId, state.profile, userId);
      const version = generation.current;
      void task.catch(error => {
        if (cancelled || !mounted.current || version !== generation.current) return;
        setState(previous => ({ ...previous, checked: null,
          connection: connectionAfterError(previous.connection, error),
          note: error instanceof Error ? error.message : 'Could not check the current profile.', noteKind: 'error' }));
      });
    }, 75);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [state.connection, state.accountId, state.profile, userId, checkProfile]);

  async function perform(task: () => Promise<void>) {
    if (running.current) return;
    running.current = true;
    setState(previous => ({ ...previous, pending: true, note: "", noteKind: "info" }));
    try { await task(); } catch (error) {
      generation.current++;
      if (mounted.current) setState(previous => ({ ...previous, checked: null,
        connection: connectionAfterError(previous.connection, error),
        note: error instanceof Error ? error.message : "Something went wrong. Retry.", noteKind: "error" }));
    } finally {
      running.current = false;
      if (mounted.current) setState(previous => ({ ...previous, pending: false }));
    }
  }

  async function refreshConnection(origin: string) {
    invalidate();
    setState(previous => ({ ...previous, connection: previous.bootstrap ? "connected" : "connecting" }));
    const loaded = await loadConnection(origin, true);
    if (!mounted.current) return;
    setState(previous => ({ ...previous, bootstrap: loaded.data, accountId: loaded.selectedAccountId,
      connection: "connected", note: loaded.note, origin, locked: loaded.locked || false, attempts: loaded.attempts || [] }));
    const profile = activeProfile.current || state.profile;
    if (profile && loaded.selectedAccountId) await checkProfile(loaded.selectedAccountId, profile, loaded.data.user.id, true);
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
    setProfile(profile: string) { invalidate(); setState(previous => ({ ...previous, profile })); },
    connect,
    lockAccount() { void perform(async () => {
      if (!state.accountId) throw new Error("Choose the account you are using on LinkedIn.");
      await sendBridge({ type: "tracking-config", accountId: state.accountId });
      await refreshConnection(normalizeCrmOrigin(state.origin));
      setState(previous => ({ ...previous, note: "Account locked for this browser profile. Reload any LinkedIn tabs opened before installing this update.", noteKind: "success" }));
    }); },
    unlockAccount() { void perform(async () => {
      await sendBridge({ type: "tracking-config", accountId: null });
      setState(previous => ({ ...previous, locked: false, note: "Unlocked. Sending stays blocked until you choose and lock the account you are using." }));
    }); },
    clearAttempt(attemptId: string) { void perform(async () => {
      await sendBridge({ type: "tracking-clear", attemptId });
      await refreshConnection(normalizeCrmOrigin(state.origin));
    }); },
    refresh() { void perform(() => refreshConnection(normalizeCrmOrigin(state.origin))); },
    check() { void perform(() => checkProfile(state.accountId, state.profile, state.bootstrap?.user.id || "", true)); },
    detect() { void perform(async () => {
      invalidate();
      const detected = await detectProfile();
      setState(previous => ({ ...previous, profile: detected.url }));
    }); },
    selectAccount(accountId: string) { void perform(async () => {
      if (state.locked) throw new Error("Unlock before selecting another LinkedIn account.");
      invalidate(); setState(previous => ({ ...previous, accountId }));
      if (!state.origin || !state.bootstrap) return;
      await rememberAccount(state.origin, state.bootstrap.user.id, accountId);
    }); },
    openCrm() { void perform(async () => { await sendBridge({ type: "open-crm" }); }); },
    openProfile() { void perform(async () => {
      await browser.tabs.create({ url: normalizeProfileUrl(state.profile) });
    }); },
  };
}

function connectionAfterError(connection: HelperState["connection"], error: unknown): HelperState["connection"] {
  return connection === "connecting" || (error instanceof BridgeError && (error.status === 401 || error.status === 403))
    ? "disconnected" : connection;
}
