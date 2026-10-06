import { browser, type Browser } from "wxt/browser";
import { defineBackground } from "wxt/utils/define-background";
import { crmPermissionPattern, normalizeCrmOrigin, normalizeProfileUrl } from "crm-shared/utils/linkedin-extension-url";
import type { ExtensionBootstrap, ExtensionCheck, ExtensionInput, ExtensionMessage, ExtensionResponse } from "crm-shared/types/linkedin-extension";
import { CrmReadCoordinator } from "../lib/crm-read-coordinator";

interface FetchResult { status: number; data?: unknown; error?: string }
const crmTabs = new Map<number, string>();

/** Serialized into the CRM tab: never reference imports or outer runtime variables here. */
async function fetchFromCrm(expectedOrigin: string, input: ExtensionInput | null): Promise<FetchResult> {
  if (location.origin !== expectedOrigin) return { status: 403, error: "The CRM tab navigated to another site. Reconnect." };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45000);
  try {
    const response = await fetch(`${expectedOrigin}/api/extension/linkedin`, {
      method: input ? "POST" : "GET", credentials: "same-origin", cache: "no-store",
      headers: { "X-CRM-Extension": "linkedin-helper-v1", ...(input ? { "Content-Type": "application/json" } : {}) },
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
    if (!(await getCrmTab(origin))) await browser.tabs.create({ url: `${origin}/linkedin-requests`, active: false });
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
  const tab = await getCrmTab(origin);
  if (tab?.id === undefined) throw new Error("Open CRM and sign in. Keep that tab open while using the extension.");
  return reads.request(origin, input ? { ...input, targetUrl: normalizeProfileUrl(input.targetUrl) } : undefined, message.fresh === true);
}

async function fetchCrm(origin: string, input?: ExtensionInput): Promise<ExtensionResponse<ExtensionBootstrap | ExtensionCheck>> {
  try {
    const tab = await getCrmTab(origin);
    if (tab?.id === undefined) throw new Error("Open CRM and sign in. Keep that tab open while using the extension.");
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

export default defineBackground(() => {
  const reads = new CrmReadCoordinator({
    async load() { const stored = await browser.storage.session.get("crmReads"); return Array.isArray(stored.crmReads) ? stored.crmReads : []; },
    async save(entries) { await browser.storage.session.set({ crmReads: entries }); },
  }, fetchCrm);
  browser.tabs.onUpdated.addListener((tabId, change) => {
    const origin = crmTabs.get(tabId);
    if (origin && (change.status === "loading" || change.url)) void reads.invalidate(origin);
  });
  browser.tabs.onRemoved.addListener(tabId => {
    const origin = crmTabs.get(tabId);
    crmTabs.delete(tabId);
    if (origin) void reads.invalidate(origin);
  });
  browser.runtime.onMessage.addListener((message: ExtensionMessage, sender, sendResponse) => {
    if (sender.id !== browser.runtime.id || sender.url !== browser.runtime.getURL("/popup.html")) {
      sendResponse({ ok: false, error: "Untrusted extension sender." });
      return false;
    }
    // The worker owns each request and persists the result before replying, even if the popup closes.
    handle(message, reads).then(sendResponse).catch((error: unknown) => sendResponse({ ok: false,
      error: error instanceof Error ? error.message : "The extension could not complete this action." }));
    return true;
  });
});
