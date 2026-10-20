import { normalizeProfileUrl } from "crm-shared/utils/linkedin-extension-url";

// LinkedIn's current profile UI renders Pending (and some Connect/Send actions)
// as plain links, without role=button or the legacy custom-invite URL.
const controls = "button, [role='button'], [role='menuitem'], a[href]";
export const label = (element: Element) => (element.getAttribute("aria-label") || element.textContent || "").replace(/\s+/g, " ").trim();
const visible = (element: Element) => {
  if (element.closest("[hidden], [aria-hidden='true']")) return false;
  const popover = element.closest('[popover]');
  if (popover) {
    try { if (!popover.matches(':popover-open')) return false; } catch { /* Older DOM implementations use computed styles. */ }
  }
  return [element, ...ancestors(element)].every(item => getComputedStyle(item).display !== "none" && getComputedStyle(item).visibility !== "hidden");
};
function ancestors(element: Element): Element[] {
  const result: Element[] = [];
  for (let parent = element.parentElement; parent; parent = parent.parentElement) result.push(parent);
  return result;
}
const menus = "[role='menu'], .artdeco-dropdown__content";
export interface ProfileMenuContext { anchor: HTMLElement; targetUrl: string; openedAt: number; alreadyVisible: Set<Element> }

function belongsToProfile(button: Element, targetUrl: string) {
  const toolbar = button.closest("[role='toolbar']");
  return !!profileCard(targetUrl)?.contains(button) || !!toolbar && Array.from(toolbar.querySelectorAll("a[href]")).some(link => {
    try { return normalizeProfileUrl(new URL(link.getAttribute("href")!, location.href).href) === targetUrl; } catch { return false; }
  });
}
export function openedProfileMenu(target: EventTarget | null, targetUrl: string): ProfileMenuContext | null {
  const button = target instanceof Element ? target.closest<HTMLElement>(controls) : null;
  return button && /^(more|more actions)$/i.test(label(button)) && belongsToProfile(button, targetUrl)
    ? { anchor: button, targetUrl, openedAt: Date.now(), alreadyVisible: new Set(Array.from(document.querySelectorAll(menus)).filter(visible)) } : null;
}
function inProfileMenu(button: Element, targetUrl: string, context?: ProfileMenuContext | null) {
  if (!context || context.targetUrl !== targetUrl || Date.now() - context.openedAt > 120_000 || !visible(button)) return false;
  // React can replace the More trigger while mounting the portal. Rebind only to
  // the viewed profile's own More button, never to a suggestion's menu trigger.
  if (!context.anchor.isConnected) {
    const card = profileCard(targetUrl);
    const replacement = card && Array.from(card.querySelectorAll<HTMLElement>(controls)).find(item => /^(more|more actions)$/i.test(label(item)));
    if (!replacement) return false;
    context.anchor = replacement;
  }
  if (!belongsToProfile(context.anchor, targetUrl)) return false;
  const ids = `${context.anchor.getAttribute('aria-controls') || ''} ${context.anchor.getAttribute('aria-owns') || ''}`.trim().split(/\s+/);
  if (ids.some(id => id && document.getElementById(id)?.contains(button))) return true;
  const menu = button.closest(menus);
  return !!menu && !context.alreadyVisible.has(menu) && visible(menu);
}
export function profileMenuContains(target: EventTarget | null, targetUrl: string, context?: ProfileMenuContext | null) {
  return target instanceof Element && inProfileMenu(target, targetUrl, context);
}
export function profileUrl(): string {
  try { return normalizeProfileUrl(location.href); } catch { return ""; }
}
export function profileCard(targetUrl: string): Element | null {
  const headings = Array.from(document.querySelectorAll("main h1, main h2"));
  const heading = headings.find(item => {
    const link = item.closest("a[href]");
    if (!link) return item.tagName === "H1";
    try { return normalizeProfileUrl(new URL(link.getAttribute("href")!, location.href).href) === targetUrl; } catch { return false; }
  });
  for (let parent = heading?.parentElement; parent && parent.tagName !== "MAIN"; parent = parent.parentElement) {
    if (Array.from(parent.querySelectorAll(controls)).some(item => /^(connect|pending|more)$|^invite .+ to connect$|^more actions$/i.test(label(item)))) return parent;
  }
  return null;
}
export function invitationDialog(): Element | null {
  return Array.from(document.querySelectorAll("[role='dialog'], dialog[open]")).find(item => visible(item) &&
    /invitation|invite .+ to connect|add a note|send without a note/i.test(item.textContent || "")) || null;
}
export function pendingOnProfile(targetUrl: string, context?: ProfileMenuContext | null): boolean {
  const card = profileCard(targetUrl);
  if (!card) return false;
  const isPending = (item: Element) => /^(pending|invitation pending)$|^pending,? (click|invitation)|^invitation sent$/i.test(label(item)) ||
    /^(pending|invitation sent)$/i.test(item.textContent?.trim() || "");
  // Most links/buttons are unrelated. Test the cheap label before computed styles,
  // and keep the common path inside the profile card rather than scanning the feed.
  if (Array.from(card.querySelectorAll(controls)).some(item => isPending(item) && visible(item))) return true;
  if (!context) return false;
  const ids = `${context.anchor.getAttribute('aria-controls') || ''} ${context.anchor.getAttribute('aria-owns') || ''}`.trim().split(/\s+/);
  const roots = new Set<Element>(Array.from(document.querySelectorAll(menus)));
  for (const id of ids) { const element = id && document.getElementById(id); if (element) roots.add(element); }
  return Array.from(roots).some(root => Array.from(root.querySelectorAll(controls)).some(item =>
    isPending(item) && inProfileMenu(item, targetUrl, context)));
}
export type PageAction = "connect" | "send" | "cancel" | "unsupported" | null;
export function invitationAction(target: EventTarget | null, targetUrl: string, hasAttempt: boolean, context?: ProfileMenuContext | null): { action: PageAction; button: HTMLElement | null } {
  const button = target instanceof Element ? target.closest<HTMLElement>(controls) : null;
  if (!button) return { action: null, button };
  const text = label(button);
  const dialog = invitationDialog();
  if (dialog?.contains(button)) {
    if (/^(send|send now|send invitation|send without a note)$/i.test(text)) return { action: hasAttempt ? "send" : "unsupported", button };
    if (/^(cancel|dismiss|close|discard)$/i.test(text)) return { action: "cancel", button };
  }
  if (/^(connect|invite .+ to connect)$/i.test(text) || button.matches("a[href*='/preload/custom-invite/']")) {
    return { action: belongsToProfile(button, targetUrl) || inProfileMenu(button, targetUrl, context) ? "connect" : "unsupported", button };
  }
  return { action: null, button };
}
