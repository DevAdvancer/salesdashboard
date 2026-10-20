import { browser, type Browser } from "wxt/browser";
import { defineBackground } from "wxt/utils/define-background";
import { crmPermissionPattern, normalizeCrmOrigin, normalizeProfileUrl } from "crm-shared/utils/linkedin-extension-url";
import type { ExtensionBootstrap, ExtensionCheck, ExtensionInput, ExtensionMessage, ExtensionResponse } from "crm-shared/types/linkedin-extension";
import { CrmReadCoordinator } from "../lib/crm-read-coordinator";
import { PageTracking, type PageMessage, type TrackingAttempt, type TrackingLock, type TrackingPreview } from "../lib/page-tracking";
import { assertCurrentLinkedinProfile, ProfileChangedError } from '../lib/page-context';

interface FetchResult { status: number; data?: unknown; error?: string }
const crmTabs = new Map<number, string>();
const VERSION_ATTRIBUTE = "data-crm-hub-linkedin-helper-version";

async function markCrmTab(tabId: number, origin: string) {
  if (!(await browser.permissions.contains({ origins: [crmPermissionPattern(origin)] }))) return;
  try {
    await browser.scripting.executeScript({ target: { tabId }, world: "ISOLATED",
      func: (expectedOrigin: string, attribute: string, version: string) => {
        if (location.origin === expectedOrigin) document.documentElement.setAttribute(attribute, version);
      }, args: [origin, VERSION_ATTRIBUTE, browser.runtime.getManifest().version] });
  } catch { /* A loading or protected tab cannot publish its version yet. */ }
}

/** Serialized into the CRM tab: never reference imports or outer runtime variables here. */
async function fetchFromCrm(expectedOrigin: string, input: ExtensionInput | null): Promise<FetchResult> {
  if (location.origin !== expectedOrigin) return { status: 403, error: "The CRM tab navigated to another site. Reconnect." };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45000);
  try {
    const response = await fetch(`${expectedOrigin}/api/extension/linkedin`, {
      method: input ? "POST" : "GET", credentials: "same-origin", cache: "no-store",
      headers: { "X-CRM-Extension": "linkedin-helper-v1", "X-CRM-Extension-Channel": "beta", ...(input ? { "Content-Type": "application/json" } : {}) },
      ...(input ? { body: JSON.stringify(input) } : {}), signal: controller.signal,
    });
    const data: unknown = await response.json().catch(() => ({ error: response.status === 404
      ? "The extension backend is not installed on this CRM yet. Use the updated local CRM or deploy the additive endpoint."
      : "CRM returned an unexpected response. Sign in and retry." }));
    return { status: response.status, data };
  } catch {
    return { status: 503, error: input?.operation === "record"
      ? "The save response was lost. Check this profile again before retrying; it may already be recorded."
      : "CRM could not be reached. Keep the CRM tab open, then retry." };
  } finally { clearTimeout(timer); }
}

async function getCrmTab(origin: string): Promise<Browser.tabs.Tab | undefined> {
  const candidates = await browser.tabs.query({ url: crmPermissionPattern(origin) });
  const tabs = candidates.filter(tab => tab.url && new URL(tab.url).origin === origin && !tab.incognito);
  for (const tab of tabs) if (tab.id !== undefined) crmTabs.set(tab.id, origin);
  return tabs.find(tab => tab.status === "complete" && tab.url && !new URL(tab.url).pathname.startsWith("/login")) ?? tabs[0];
}

async function handle(message: ExtensionMessage, reads: CrmReadCoordinator): Promise<ExtensionResponse> {
  const settings = await browser.storage.local.get("crmOrigin");
  const origin = normalizeCrmOrigin(settings.crmOrigin);
  if (message.type === "ensure-crm") {
    const tab = await getCrmTab(origin);
    if (tab?.id !== undefined) await markCrmTab(tab.id, origin);
    else await browser.tabs.create({ url: `${origin}/linkedin-requests`, active: false });
    return { ok: true };
  }
  if (message.type === "open-crm") {
    const tab = await getCrmTab(origin);
    if (tab?.id !== undefined) {
      await browser.tabs.update(tab.id, { active: true });
      await browser.windows.update(tab.windowId, { focused: true });
    } else await browser.tabs.create({ url: `${origin}/linkedin-requests` });
    return { ok: true };
  }
  if (message.type !== "crm-api") throw new Error("Unknown extension operation.");
  const input = message.input ?? null;
  if (input && !["check", "history", "record"].includes(input.operation)) throw new Error("Unknown CRM operation.");
  if (!(await browser.permissions.contains({ origins: [crmPermissionPattern(origin)] }))) {
    throw new Error("Reconnect to grant access to this CRM hostname.");
  }
  return reads.request(origin, input ? { ...input, targetUrl: normalizeProfileUrl(input.targetUrl) } : undefined, message.fresh === true);
}

async function fetchCrm(origin: string, input?: ExtensionInput): Promise<ExtensionResponse<ExtensionBootstrap | ExtensionCheck>> {
  try {
    const tab = await getCrmTab(origin);
    if (tab?.id === undefined) throw new Error("Open CRM and sign in. Keep that tab open while using the extension.");
    await markCrmTab(tab.id, origin);
    const results = await browser.scripting.executeScript({ target: { tabId: tab.id },
      world: "ISOLATED", func: fetchFromCrm, args: [origin, input ?? null] });
    const result = results[0]?.result;
    if (!result) throw new Error("The CRM tab is loading. Wait a moment and retry.");
    if (result.status < 200 || result.status >= 300) {
      const data = result.data as { error?: string } | undefined;
      return { ok: false, status: result.status, error: result.error || data?.error || "CRM request failed." };
    }
    return { ok: true, data: result.data as ExtensionBootstrap | ExtensionCheck };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "The CRM connection was interrupted. Retry." };
  }
}

async function observeCrmContext(origin: string, response: ExtensionResponse, tracking: PageTracking) {
  if (!response.ok) {
    if ([401, 403].includes(response.status || 0)) await tracking.invalidate(origin);
    return;
  }
  const data = response.data;
  if (typeof data !== 'object' || !data || !('user' in data)) return;
  const user = data.user;
  if (typeof user !== 'object' || !user || !('id' in user)) return;
  const stored = await browser.storage.local.get('trackingLock') as { trackingLock?: TrackingLock };
  if (stored.trackingLock?.origin === origin && user.id !== stored.trackingLock.userId) await tracking.invalidate(origin);
}

export default defineBackground(() => {
  const reads = new CrmReadCoordinator({
    async load() { const stored = await browser.storage.session.get("crmReads"); return Array.isArray(stored.crmReads) ? stored.crmReads : []; },
    async save(entries) { await browser.storage.session.set({ crmReads: entries }); },
  }, fetchCrm);
  const tracking = new PageTracking({
    async lock() { return (await browser.storage.local.get("trackingLock")).trackingLock as TrackingLock || null; },
    async setLock(lock) { await browser.storage.local.set({ trackingLock: lock }); },
    async attempts() { return (await browser.storage.session.get("trackingAttempts")).trackingAttempts as TrackingAttempt[] || []; },
    async saveAttempts(attempts) { await browser.storage.session.set({ trackingAttempts: attempts }); },
    async previews() { return (await browser.storage.session.get('trackingPreviews')).trackingPreviews as TrackingPreview[] || []; },
    async savePreviews(previews) { await browser.storage.session.set({ trackingPreviews: previews }); },
  }, async <T>(origin: string, input?: ExtensionInput) => {
    if (!(await browser.permissions.contains({ origins: [crmPermissionPattern(origin)] }))) throw new Error("Reconnect CRM to grant access.");
    const response = await reads.request(origin, input, true);
    await observeCrmContext(origin, response, tracking);
    if (!response.ok || !response.data) throw new Error(!response.ok ? response.error : "CRM returned no data.");
    return response.data as T;
  });
  browser.tabs.onUpdated.addListener((tabId, change, tab) => {
    const origin = crmTabs.get(tabId);
    if (origin && (change.status === "loading" || change.url)) { void reads.invalidate(origin); void tracking.invalidate(origin); }
    if (change.status === "complete" && tab.url) {
      void browser.storage.local.get("crmOrigin").then(async stored => {
        if (!stored.crmOrigin) return;
        const expected = normalizeCrmOrigin(stored.crmOrigin);
        if (new URL(tab.url!).origin === expected) {
          await tracking.invalidate(expected);
          return markCrmTab(tabId, expected);
        }
      }).catch(() => {});
    }
  });
  browser.tabs.onRemoved.addListener(tabId => {
    const origin = crmTabs.get(tabId);
    crmTabs.delete(tabId);
    if (origin) { void reads.invalidate(origin); void tracking.invalidate(origin); }
  });
  browser.runtime.onMessage.addListener((message: ExtensionMessage | PageMessage, sender, sendResponse) => {
    const popup = sender.url === browser.runtime.getURL("/popup.html");
    let linkedin = false;
    try {
      const url = new URL(sender.url || "");
      linkedin = url.protocol === "https:" && ["www.linkedin.com", "linkedin.com"].includes(url.hostname) && !url.port &&
        sender.frameId === 0 && sender.tab?.id !== undefined && !sender.tab.incognito;
    } catch { /* Reject malformed sender metadata. */ }
    const pageOperation = ["page-status", "page-prepare", "page-sent", "page-cancel", "page-validate", "page-recover"].includes(message?.type);
    if (sender.id !== browser.runtime.id || (!popup && !linkedin) || (linkedin && !pageOperation)) {
      sendResponse({ ok: false, error: "Untrusted extension sender." });
      return false;
    }
    // The worker owns each request and persists the result before replying, even if the popup closes.
    const work = async () => {
      const settings = await browser.storage.local.get("crmOrigin");
      const origin = normalizeCrmOrigin(settings.crmOrigin);
      if (message.type === "tracking-config" && popup) return { ok: true, data: await tracking.configure(origin, message.accountId) };
      if (message.type === "tracking-clear" && popup) { await tracking.clearReviewed(message.attemptId); return { ok: true }; }
      if (pageOperation && linkedin) {
        const input = message as PageMessage;
        if (!(await browser.permissions.contains({ origins: [crmPermissionPattern(origin)] }))) throw new Error('Reconnect CRM to grant access.');
        await assertCurrentLinkedinProfile(sender.tab!.id!, input.targetUrl, tabId => browser.tabs.get(tabId));
        return { ok: true, data: await tracking.handle(origin, sender.tab!.id!, input) };
      }
      if (!popup || pageOperation) throw new Error("Untrusted extension operation.");
      const input = message as ExtensionMessage;
      if (input.type === 'crm-api' && input.input?.operation === 'check') {
        if (!(await browser.permissions.contains({ origins: [crmPermissionPattern(origin)] }))) throw new Error('Reconnect CRM to grant access.');
        const check = await tracking.readPreview(origin, input.input.accountId, input.input.targetUrl, input.fresh === true);
        if (check) return { ok: true, data: check };
      }
      if (input.type === 'crm-api' && input.input?.operation === 'record') await tracking.invalidate(origin);
      try {
        const response = await handle(input, reads);
        await observeCrmContext(origin, response, tracking);
        return response;
      } finally { if (input.type === 'crm-api' && input.input?.operation === 'record') await tracking.invalidate(origin); }
    };
    // Slow availability reads for a previous profile must not hold up the current
    // profile or a confirmed save. Keep every mutation in the serialized queue.
    ((pageOperation && message.type !== 'page-status') || message.type === "tracking-config" || message.type === "tracking-clear" ? tracking.run(work) : work()).then(sendResponse).catch((error: unknown) => sendResponse({ ok: false,
      ...(error instanceof ProfileChangedError ? { code: error.code } : {}),
      error: error instanceof Error ? error.message : "The extension could not complete this action." }));
    return true;
  });
});
