import { browser } from "wxt/browser";
import { normalizeCrmOrigin, normalizeProfileUrl } from "crm-shared/utils/linkedin-extension-url";
import type { ExtensionBootstrap, ExtensionInput, ExtensionMessage, ExtensionResponse } from "crm-shared/types/linkedin-extension";

export class BridgeError extends Error {
  constructor(message: string, public status?: number) { super(message); }
}

export async function sendBridge<T = unknown>(message: ExtensionMessage): Promise<T | undefined> {
  const response = await browser.runtime.sendMessage(message) as ExtensionResponse<T> | undefined;
  if (!response?.ok) throw new BridgeError(response?.error || "The CRM connection was interrupted. Retry.", response && !response.ok ? response.status : undefined);
  return response.data;
}

export async function requestCrm<T>(input?: ExtensionInput, fresh = false): Promise<T> {
  const data = await sendBridge<T>({ type: "crm-api", input, fresh });
  if (!data) throw new Error("CRM returned an empty response. Refresh and retry.");
  return data;
}

export async function loadConnection(origin: string, fresh = false) {
  const data = await requestCrm<ExtensionBootstrap>(undefined, fresh);
  const stored = await browser.storage.local.get("selectedAccounts") as { selectedAccounts?: Record<string, string> };
  const previous = stored.selectedAccounts?.[`${normalizeCrmOrigin(origin)}|${data.user.id}`];
  const available = data.accounts.filter(account => account.remaining !== 0 && account.limit !== null);
  const selectedAccountId = available.some(account => account.id === previous) ? previous! : previous ? "" : available[0]?.id || "";
  const note = !data.accounts.length ? "No active accounts are assigned or delegated to you. Ask your team lead." :
    !available.length ? "No account has an available allowance. Ask your team lead or return tomorrow." :
    previous && !selectedAccountId ? "Your previous account is unavailable. Choose the LinkedIn account you are using." : "";
  return { data, selectedAccountId, note };
}

export async function rememberAccount(origin: string, userId: string, accountId: string) {
  const stored = await browser.storage.local.get("selectedAccounts") as { selectedAccounts?: Record<string, string> };
  await browser.storage.local.set({ selectedAccounts: { ...stored.selectedAccounts, [`${origin}|${userId}`]: accountId } });
}

export async function rememberedProfile(origin: string, userId: string): Promise<string> {
  const stored = await browser.storage.session.get("lastProfile");
  const profile = stored.lastProfile as { origin?: string; userId?: string; url?: string } | undefined;
  return profile?.origin === origin && profile.userId === userId ? profile.url || "" : "";
}

export async function rememberProfile(origin: string, userId: string, url: string) {
  await browser.storage.session.set({ lastProfile: { origin, userId, url } });
}

export async function detectProfile() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  try { return { url: normalizeProfileUrl(tab?.url), tabId: tab?.id ?? null }; }
  catch { throw new Error("Open a public LinkedIn profile, then click Detect. You can also paste its URL."); }
}
