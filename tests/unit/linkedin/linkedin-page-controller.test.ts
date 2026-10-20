/**
 * @jest-environment jsdom
 * @jest-environment-options {"url":"https://www.linkedin.com/in/person/"}
 */
jest.mock("crm-shared/utils/linkedin-extension-url", () => jest.requireActual("@/lib/utils/linkedin-extension-url"), { virtual: true });
jest.mock("crm-shared/utils/eastern-date", () => jest.requireActual("@/lib/utils/eastern-date"), { virtual: true });
import { LinkedinPageController } from "@/extensions/linkedin-helper/lib/linkedin-page-controller";
import { invitationAction } from "@/extensions/linkedin-helper/lib/linkedin-page-dom";
import { pendingOnProfile } from "@/extensions/linkedin-helper/lib/linkedin-page-dom";
import { ProfileChangedError } from '@/extensions/linkedin-helper/lib/page-context';
import type { ExtensionCheck } from "@/lib/types/linkedin-extension";
import { PageTracking, type TrackingAttempt, type TrackingRequest } from '@/extensions/linkedin-helper/lib/page-tracking';

const targetUrl = "https://www.linkedin.com/in/person";
const check: ExtensionCheck = { user: { id: "agent", name: "Agent" }, today: "2026-10-16", account: {
  id: "account", name: "Main ID", company: "Silverspace", type: "main", connectionLimit: 3 },
  targetUrl, state: "new", canRecord: true, revision: "rev", history: [], previousRequest: null, used: 1, limit: 3, remaining: 2 };
let stop: (() => void) | undefined;
beforeEach(() => {
  jest.useFakeTimers().setSystemTime(new Date("2026-10-16T15:00:00Z"));
  window.history.replaceState({}, "", "/in/person/");
  document.body.innerHTML = `<main><section id="profile"><a href="/in/person/"><h2>Person</h2></a><button id="connect">Connect</button><button>More</button></section>
    <aside><button id="suggestion" aria-label="Invite Someone Else to connect">Connect</button><button>Pending</button></aside></main>`;
});
afterEach(() => { stop?.(); stop = undefined; jest.useRealTimers(); });

function fixture(override: Partial<ExtensionCheck> = {}) {
  const data = { ...check, ...override };
  const attempt = { id: "attempt", origin: "http://localhost:5000", userId: "agent", accountId: "account", tabId: 7, targetUrl, revision: "rev", confirmResend: false, state: "armed", expiresAt: Date.now() + 120000 };
  const request = jest.fn(async (message: any) => message.type === "page-sent" ? { ...data, mode: "created", remaining: 1 }
    : message.type === "page-cancel" ? { cancelled: true }
    : { check: data, ...(message.type === "page-status" ? {} : { attempt }) });
  const controller = new LinkedinPageController(request as any);
  stop = controller.start();
  return { controller, request, data };
}
async function settle() { await jest.advanceTimersByTimeAsync(0); }
function click(controller: LinkedinPageController, selector: string) {
  const event = { target: document.querySelector(selector), isTrusted: true, preventDefault: jest.fn(), stopImmediatePropagation: jest.fn() };
  controller.onClick(event as unknown as MouseEvent);
  // The extension only observes. LinkedIn receives the original click immediately.
  expect(event.preventDefault).not.toHaveBeenCalled();
  expect(event.stopImmediatePropagation).not.toHaveBeenCalled();
  if (event.target instanceof HTMLElement) event.target.click();
  else event.target!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  return event;
}
function dialog() {
  const element = document.createElement("div");
  element.setAttribute("role", "dialog");
  element.innerHTML = '<h2>Send an invitation</h2><button id="send">Send without a note</button><button id="cancel">Cancel</button>';
  document.body.append(element);
  return element;
}
const root = () => document.querySelector("#crm-hub-linkedin-status")!.shadowRoot!;

it('reuses the worker result on tab focus without flashing Checking, and forces a request only for Recheck', async () => {
  const f = fixture(); await settle();
  let resolve!: (value: unknown) => void;
  f.request.mockReturnValueOnce(new Promise(done => { resolve = done; }));
  window.dispatchEvent(new Event('focus'));
  expect(root().querySelector('#crm-dialog-title')).toHaveTextContent('Available');
  expect(f.request).toHaveBeenLastCalledWith({ type: 'page-status', targetUrl });
  resolve({ check }); await settle();
  root().querySelector<HTMLButtonElement>('#refresh')!.click(); await settle();
  expect(f.request).toHaveBeenLastCalledWith({ type: 'page-status', targetUrl, fresh: true });
});

it.each([["new", "ready", "Available"], ["limit_reached", "blocked", "Limit reached"],
  ["existing_lead", "blocked", "Present in CRM"], ["active_request", "blocked", "Already sent"],
  ["resend_available", "warning", "Resend available"]] as const)(
  "shows a single-line status for %s with details collapsed", async (state, tone, title) => {
    fixture({ state, canRecord: state === "new" || state === "resend_available" }); await settle();
    expect(root().querySelector('.card')).toHaveAttribute("data-tone", tone);
    expect(root().querySelector('#crm-dialog-title')!.textContent).toBe(title);
    expect(root().querySelector('#details')).toHaveAttribute('hidden');
    expect(root().querySelector('[role=dialog]')).toBeNull();
    expect(root().textContent).not.toMatch(/View history|Connection history/);
  },
);

it("only records after the agent's send and a stable Pending transition, then shows confirmation", async () => {
  const f = fixture(); await settle();
  document.querySelector("#connect")!.addEventListener("click", () => {
    const modal = dialog();
    modal.querySelector("#send")!.addEventListener("click", () => {
      document.querySelector("#connect")!.textContent = "Pending"; modal.remove();
    });
  });
  click(f.controller, "#connect"); await settle();
  expect(f.request.mock.calls.some(([m]) => m.type === "page-sent")).toBe(false);
  click(f.controller, "#send"); await settle();
  expect(f.request.mock.calls.some(([m]) => m.type === "page-validate")).toBe(false);
  expect(f.request.mock.calls.some(([m]) => m.type === "page-sent")).toBe(false);
  await jest.advanceTimersByTimeAsync(2400);
  expect(f.request.mock.calls.filter(([m]) => m.type === "page-sent")).toHaveLength(1);
  expect(root().querySelector('#crm-dialog-title')!.textContent).toBe('Sent');
  expect(root().querySelector(".note")!.textContent).toContain("Main ID. 1 requests remaining");
  await jest.advanceTimersByTimeAsync(5000);
  expect(f.request.mock.calls.filter(([m]) => m.type === "page-sent")).toHaveLength(1);
});

it("allows LinkedIn's click immediately even when CRM rejects quota, without replaying it", async () => {
  const f = fixture(); await settle();
  const handler = jest.fn(); document.querySelector("#connect")!.addEventListener("click", handler);
  f.request.mockRejectedValueOnce(new Error("Daily CRM limit reached"));
  const event = click(f.controller, "#connect"); await settle();
  expect(event.preventDefault).not.toHaveBeenCalled();
  expect(handler).toHaveBeenCalledTimes(1);
  expect(root().querySelector(".card")).toHaveAttribute("data-tone", "blocked");
  expect(f.request.mock.calls.some(([m]) => m.type === "page-sent")).toBe(false);
});

it("cancels a dialog without recording, including dismissal without a button click", async () => {
  const f = fixture(); await settle();
  document.querySelector("#connect")!.addEventListener("click", dialog);
  click(f.controller, "#connect"); await settle();
  await jest.advanceTimersByTimeAsync(400);
  document.querySelector("[role=dialog]")!.remove();
  await jest.advanceTimersByTimeAsync(2400);
  expect(f.request.mock.calls.some(([m]) => m.type === "page-cancel")).toBe(true);
  expect(f.request.mock.calls.some(([m]) => m.type === "page-sent")).toBe(false);
});

it("ignores another person's Pending and leaves suggestion invites usable without misattributing them", async () => {
  const f = fixture(); await settle();
  expect(invitationAction(document.querySelector("#suggestion"), targetUrl, false).action).toBe("unsupported");
  click(f.controller, "#suggestion"); await settle();
  expect(f.request.mock.calls.some(([m]) => m.type === "page-prepare")).toBe(false);
  expect(f.request.mock.calls.some(([m]) => m.type === "page-sent")).toBe(false);
});

it("does not count an already Pending invitation or automatically replay a synthetic Connect", async () => {
  const f = fixture(); await settle();
  document.querySelector("#connect")!.textContent = "Pending";
  await jest.advanceTimersByTimeAsync(3000);
  expect(f.request.mock.calls.some(([m]) => m.type === "page-sent")).toBe(false);
  document.querySelector("#connect")!.textContent = "Connect";
  (document.querySelector("#connect") as HTMLButtonElement).click(); await settle();
  expect(f.request.mock.calls.some(([m]) => m.type === "page-prepare")).toBe(false);
});

it("clears a transient Pending signal and never records LinkedIn failure as a send", async () => {
  const f = fixture(); await settle();
  document.querySelector("#connect")!.addEventListener("click", () => { document.querySelector("#connect")!.textContent = "Pending"; });
  click(f.controller, "#connect"); await settle();
  await jest.advanceTimersByTimeAsync(800);
  document.querySelector("#connect")!.textContent = "Connect";
  document.body.insertAdjacentHTML("beforeend", '<div role="alert">Unable to send invitation. Try again.</div>');
  await jest.advanceTimersByTimeAsync(3000);
  expect(f.request.mock.calls.some(([m]) => m.type === "page-sent")).toBe(false);
});

it("keeps a resend yellow until the agent explicitly confirms it", async () => {
  const f = fixture({ state: "resend_available" }); await settle();
  click(f.controller, "#connect"); await settle();
  expect(root().querySelector(".card")).toHaveAttribute("data-tone", "warning");
  expect(f.request.mock.calls.some(([m]) => m.type === "page-prepare")).toBe(false);
  expect(root().querySelector('#details')).not.toHaveAttribute('hidden');
  (root().querySelector("input") as HTMLInputElement).click();
  click(f.controller, "#connect"); await settle();
  expect(f.request.mock.calls.some(([m]) => m.type === "page-prepare" && m.confirmResend === true)).toBe(true);
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}

it('checks the next profile immediately while the previous profile check is still in flight', async () => {
  const previous = deferred<any>();
  const next = 'https://www.linkedin.com/in/next-person';
  const request = jest.fn((message: any) => message.targetUrl === targetUrl ? previous.promise :
    Promise.resolve({ check: { ...check, targetUrl: next, state: 'existing_lead', canRecord: false } }));
  const controller = new LinkedinPageController(request as any);
  stop = controller.start();
  window.history.pushState({}, '', '/in/next-person/');
  await jest.advanceTimersByTimeAsync(400);
  expect(request).toHaveBeenCalledWith({ type: 'page-status', targetUrl: next });
  expect(root().querySelector('#crm-dialog-title')!.textContent).toBe('Present in CRM');
  previous.resolve({ check });
  await settle();
  expect(root().querySelector('#crm-dialog-title')!.textContent).toBe('Present in CRM');
  expect(request.mock.calls.some(([message]) => message.type === 'page-sent')).toBe(false);
});

it('retries a failed profile check automatically without requiring a page reload', async () => {
  const request = jest.fn().mockRejectedValueOnce(new Error('The LinkedIn profile changed.'))
    .mockResolvedValue({ check });
  const controller = new LinkedinPageController(request as any);
  stop = controller.start(); await settle();
  expect(root().querySelector('#crm-dialog-title')!.textContent).toBe('CRM tracking unavailable');
  await jest.advanceTimersByTimeAsync(2400);
  expect(request).toHaveBeenCalledTimes(2);
  expect(root().querySelector('#crm-dialog-title')!.textContent).toBe('Available');
});

it('shows Checking rather than a red block or false account-lock message during a navigation mismatch', async () => {
  const request = jest.fn().mockRejectedValueOnce(new ProfileChangedError()).mockResolvedValue({ check });
  const controller = new LinkedinPageController(request as any);
  stop = controller.start(); await settle();
  expect(root().querySelector('.card')).toHaveAttribute('data-tone', 'info');
  expect(root().querySelector('#crm-dialog-title')!.textContent).toBe('Checking…');
  expect(root().querySelector('.account')).toHaveAttribute('hidden');
  expect(root().textContent).not.toContain('Choose and lock your account');
  await jest.advanceTimersByTimeAsync(800);
  expect(root().querySelector('#crm-dialog-title')!.textContent).toBe('Available');
  expect(root().querySelector('.card')).toHaveAttribute('data-tone', 'ready');
  expect(request).toHaveBeenCalledTimes(2);
});

it('removes the old status when leaving a public profile and ignores its late response', async () => {
  const previous = deferred<any>();
  const controller = new LinkedinPageController(jest.fn(() => previous.promise) as any);
  stop = controller.start();
  window.history.pushState({}, '', '/feed/');
  await jest.advanceTimersByTimeAsync(400);
  expect(document.querySelector('#crm-hub-linkedin-status')).toBeNull();
  previous.resolve({ check }); await settle();
  expect(document.querySelector('#crm-hub-linkedin-status')).toBeNull();
});

function realTrackingFixture() {
  const origin = 'http://localhost:5000';
  let attempts: TrackingAttempt[] = [];
  const crm = jest.fn(async (_origin: string, input: any) => input.operation === 'record'
    ? { ...check, state: 'active_request', canRecord: false, mode: 'created', remaining: 1 } : check);
  const tracking = new PageTracking({
    lock: async () => ({ origin, accountId: 'account', userId: 'agent' }), setLock: async () => {},
    attempts: async () => JSON.parse(JSON.stringify(attempts)),
    saveAttempts: async next => { attempts = JSON.parse(JSON.stringify(next)); },
  }, crm as TrackingRequest, () => Date.now(), () => 'live-attempt');
  const request = jest.fn((message: any) => tracking.run(() => tracking.handle(origin, 7, message)));
  const controller = new LinkedinPageController(request as any);
  stop = controller.start();
  return { controller, request, crm, attempts: () => attempts };
}

it('keeps observing a live guarded send when status refreshes, using the real tracking store', async () => {
  const f = realTrackingFixture(); await settle();
  document.querySelector('#connect')!.addEventListener('click', () => { document.querySelector('#connect')!.textContent = 'Pending'; });
  click(f.controller, '#connect'); await settle();
  await f.controller.refresh();
  expect(root().querySelector('#crm-dialog-title')!.textContent).toBe('Awaiting confirmation');
  await jest.advanceTimersByTimeAsync(2400);
  expect(root().querySelector('#crm-dialog-title')!.textContent).toBe('Sent');
  expect(f.crm.mock.calls.filter(([, input]) => input.operation === 'record')).toHaveLength(1);
  expect(f.attempts()).toEqual([]);
});

it('requires explicit account confirmation and stable Pending to recover an interrupted attempt exactly once', async () => {
  const f = realTrackingFixture(); await settle();
  document.querySelector('#connect')!.addEventListener('click', () => { document.querySelector('#connect')!.textContent = 'Pending'; });
  click(f.controller, '#connect'); await settle();
  stop!();
  // Reload after the guarded click; the persisted attempt alone must never auto-record.
  await jest.advanceTimersByTimeAsync(121000);
  const restarted = new LinkedinPageController(f.request as any);
  stop = restarted.start(); await settle();
  expect(root().querySelector('#crm-dialog-title')!.textContent).toBe('Needs review');
  expect(root().querySelector('#recover')).toBeDisabled();
  await jest.advanceTimersByTimeAsync(2400);
  expect(f.crm.mock.calls.filter(([, input]) => input.operation === 'record')).toHaveLength(0);
  (root().querySelector('#recovery-confirm') as HTMLInputElement).click();
  expect(root().querySelector('#recover')).not.toBeDisabled();
  (root().querySelector('#recover') as HTMLButtonElement).click(); await settle();
  expect(root().querySelector('#crm-dialog-title')!.textContent).toBe('Sent');
  expect(f.crm.mock.calls.filter(([, input]) => input.operation === 'record')).toHaveLength(1);
  expect(f.attempts()).toEqual([]);
  await jest.advanceTimersByTimeAsync(5000);
  expect(f.crm.mock.calls.filter(([, input]) => input.operation === 'record')).toHaveLength(1);
});

it('rechecks Pending when recovery is clicked instead of trusting a previously visible signal', async () => {
  const f = realTrackingFixture(); await settle();
  click(f.controller, '#connect'); await settle(); stop!();
  document.querySelector('#connect')!.textContent = 'Pending';
  stop = new LinkedinPageController(f.request as any).start(); await settle();
  await jest.advanceTimersByTimeAsync(2400);
  (root().querySelector('#recovery-confirm') as HTMLInputElement).click();
  document.querySelector('#connect')!.textContent = 'Connect';
  (root().querySelector('#recover') as HTMLButtonElement).click(); await settle();
  expect(f.crm.mock.calls.filter(([, input]) => input.operation === 'record')).toHaveLength(0);
});

it('tracks More → Connect → Send with a removed Connect item, cached availability, and a slow final save', async () => {
  const f = realTrackingFixture(); await settle();
  document.querySelector('#connect')!.remove();
  const more = document.querySelector('#profile button') as HTMLButtonElement;
  more.id = 'more'; more.setAttribute('aria-controls', 'profile-menu');
  more.addEventListener('click', () => {
    document.body.insertAdjacentHTML('beforeend', '<div id="profile-menu" role="menu"><div role="menuitem" id="menu-connect">Connect</div></div>');
    document.querySelector('#menu-connect')!.addEventListener('click', () => {
      document.querySelector('#profile-menu')!.remove();
      const modal = dialog();
      modal.querySelector('#send')!.addEventListener('click', () => {
        modal.remove();
        more.insertAdjacentHTML('beforebegin', '<button id="pending">Pending</button>');
        document.body.insertAdjacentHTML('beforeend', '<div role="alert">Invitation sent to Person.</div>');
      });
    });
  });
  const pendingSave = deferred<any>();
  f.crm.mockImplementationOnce(() => pendingSave.promise);
  click(f.controller, '#more');
  click(f.controller, '#menu-connect');
  expect(document.querySelector('#send')).not.toBeNull(); // no CRM wait
  click(f.controller, '#send');
  expect(document.querySelector('#pending')).not.toBeNull(); // sending does not wait for the save
  expect(f.crm.mock.calls.filter(([, input]) => input.operation === 'record')).toHaveLength(0);
  await jest.advanceTimersByTimeAsync(1800);
  expect(f.crm.mock.calls.map(([, input]) => input.operation)).toEqual(['check', 'record']);
  pendingSave.resolve({ ...check, mode: 'created', remaining: 1 }); await settle();
  expect(root().querySelector('#crm-dialog-title')!.textContent).toBe('Sent');
  expect(f.crm.mock.calls.filter(([, input]) => input.operation === 'record')).toHaveLength(1);
});

it('recognizes a newly opened profile dropdown without aria-controls, while ignoring an already visible unrelated menu', async () => {
  const f = fixture(); await settle();
  document.querySelector('#profile')!.insertAdjacentHTML('beforeend', '<button id="more">More</button>');
  document.body.insertAdjacentHTML('beforeend', '<div role="menu"><button id="other-connect">Connect</button></div>');
  click(f.controller, '#more');
  click(f.controller, '#other-connect');
  expect(f.request.mock.calls.some(([m]) => m.type === 'page-prepare')).toBe(false);
  click(f.controller, '#more'); // Return to this profile after interacting with the unrelated menu.
  document.body.insertAdjacentHTML('beforeend', '<div class="artdeco-dropdown__content"><div role="menuitem" id="new-connect">Connect</div></div>');
  click(f.controller, '#new-connect'); await settle();
  expect(f.request.mock.calls.filter(([m]) => m.type === 'page-prepare')).toHaveLength(1);
});

it('does not count a success toast by itself', async () => {
  const f = realTrackingFixture(); await settle();
  click(f.controller, '#connect'); await settle();
  document.body.insertAdjacentHTML('beforeend', '<div role="alert">Invitation sent to Arpit.</div>');
  await jest.advanceTimersByTimeAsync(3000);
  expect(f.crm.mock.calls.filter(([, input]) => input.operation === 'record')).toHaveLength(0);
});

it('drops More-menu attribution when a different profile suggestion is clicked', async () => {
  const f = fixture(); await settle();
  document.querySelector('#profile')!.insertAdjacentHTML('beforeend', '<button id="more">More</button>');
  document.querySelector('aside')!.insertAdjacentHTML('beforeend', '<button id="suggestion-more">More</button>');
  click(f.controller, '#more');
  click(f.controller, '#suggestion-more');
  document.body.insertAdjacentHTML('beforeend', '<div role="menu"><button id="foreign-connect">Connect</button></div>');
  click(f.controller, '#foreign-connect'); await settle();
  expect(f.request.mock.calls.some(([m]) => m.type === 'page-prepare')).toBe(false);
});

it('lets keyboard submission through without preventing or replaying it', async () => {
  const f = fixture(); await settle();
  click(f.controller, '#connect'); await settle();
  const modal = dialog(); modal.insertAdjacentHTML('beforeend', '<textarea id="note"></textarea>');
  const event = new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true });
  const prevent = jest.spyOn(event, 'preventDefault');
  const stopPropagation = jest.spyOn(event, 'stopImmediatePropagation');
  document.querySelector('#note')!.dispatchEvent(event);
  expect(prevent).not.toHaveBeenCalled();
  expect(stopPropagation).not.toHaveBeenCalled();
});

function currentLinkedinPendingLink() {
  // Observed in Prabhleen Kaur's live profile on 2026-10-19: a plain A tag,
  // no button role, href points back to the profile, and a nested Pending span.
  return `<a href="${targetUrl}/" aria-disabled="false"
    componentkey="ConnectButtonstate:invitation:urn:li:member:1297975926_pending"
    aria-label="Pending, click to withdraw invitation sent to Person"><span><svg aria-hidden="true"></svg><span>Pending</span></span></a>`;
}

it('recognizes the live LinkedIn Pending anchor and records the observed send exactly once', async () => {
  const f = realTrackingFixture(); await settle();
  document.querySelector('#connect')!.addEventListener('click', () => {
    document.querySelector('#connect')!.outerHTML = currentLinkedinPendingLink();
  });
  click(f.controller, '#connect'); await settle();
  expect(pendingOnProfile(targetUrl)).toBe(true);
  await jest.advanceTimersByTimeAsync(2400);
  expect(root().querySelector('#crm-dialog-title')!.textContent).toBe('Sent');
  expect(f.crm.mock.calls.filter(([, input]) => input.operation === 'record')).toHaveLength(1);
});

it('enables reviewed recovery for the live Pending anchor after an interrupted attempt', async () => {
  const f = realTrackingFixture(); await settle();
  click(f.controller, '#connect'); await settle(); stop!();
  document.querySelector('#connect')!.outerHTML = currentLinkedinPendingLink();
  await jest.advanceTimersByTimeAsync(121000);
  stop = new LinkedinPageController(f.request as any).start(); await settle();
  (root().querySelector('#recovery-confirm') as HTMLInputElement).click();
  expect(root().querySelector('#recover')).toBeDisabled();
  await jest.advanceTimersByTimeAsync(2400);
  expect(root().querySelector('#recover')).not.toBeDisabled();
  (root().querySelector('#recover') as HTMLButtonElement).click(); await settle();
  expect(root().querySelector('#crm-dialog-title')!.textContent).toBe('Sent');
  expect(f.crm.mock.calls.filter(([, input]) => input.operation === 'record')).toHaveLength(1);
});

it('ignores Pending links belonging to suggested profiles or hidden menus', async () => {
  fixture(); await settle();
  document.querySelector('aside')!.insertAdjacentHTML('beforeend', currentLinkedinPendingLink());
  document.querySelector('#profile')!.insertAdjacentHTML('beforeend', `<div style="display:none">${currentLinkedinPendingLink()}</div>`);
  expect(pendingOnProfile(targetUrl)).toBe(false);
});

it('overlaps stable Pending observation with a slow CRM preparation instead of adding a second wait', async () => {
  const f = realTrackingFixture();
  const preparing = deferred<any>(); f.crm.mockReturnValueOnce(preparing.promise);
  await settle(); // The first availability request is still running when Connect is clicked.
  document.querySelector('#connect')!.addEventListener('click', () => {
    document.querySelector('#connect')!.outerHTML = currentLinkedinPendingLink();
  });
  click(f.controller, '#connect'); await settle();
  await jest.advanceTimersByTimeAsync(2200);
  expect(f.crm.mock.calls.filter(([, input]) => input.operation === 'record')).toHaveLength(0);
  preparing.resolve(check); await settle();
  expect(f.crm.mock.calls.filter(([, input]) => input.operation === 'record')).toHaveLength(1);
  expect(root().querySelector('#crm-dialog-title')!.textContent).toBe('Sent');
});

it('saves at the 1.6-second stability deadline without another polling interval', async () => {
  const f = realTrackingFixture(); await settle();
  document.querySelector('#connect')!.addEventListener('click', () => {
    document.querySelector('#connect')!.outerHTML = currentLinkedinPendingLink();
  });
  click(f.controller, '#connect'); await settle();
  await jest.advanceTimersByTimeAsync(1599);
  expect(f.crm.mock.calls.filter(([, input]) => input.operation === 'record')).toHaveLength(0);
  await jest.advanceTimersByTimeAsync(1);
  expect(f.crm.mock.calls.filter(([, input]) => input.operation === 'record')).toHaveLength(1);
});

it('limits expensive style reads to Pending candidates rather than unrelated page controls', () => {
  document.querySelector('#profile')!.insertAdjacentHTML('beforeend', Array.from({ length: 200 }, (_, i) => `<a href="#${i}">Other action ${i}</a>`).join('') + currentLinkedinPendingLink());
  document.querySelector('aside')!.insertAdjacentHTML('beforeend', '<a href="#">Pending</a>'.repeat(1000));
  const styles = jest.spyOn(window, 'getComputedStyle');
  try {
    expect(pendingOnProfile(targetUrl)).toBe(true);
    expect(styles.mock.calls.length).toBeLessThan(20);
    expect(styles.mock.calls.some(([element]) => element.closest('aside'))).toBe(false);
  } finally { styles.mockRestore(); }
});

it('records a checked profile with only the initial check and final save, with no recheck while awaiting Connect', async () => {
  const f = realTrackingFixture(); await settle();
  await jest.advanceTimersByTimeAsync(30_000);
  expect(f.crm.mock.calls.map(([, input]) => input.operation)).toEqual(['check']);
  document.querySelector('#connect')!.addEventListener('click', () => { document.querySelector('#connect')!.outerHTML = currentLinkedinPendingLink(); });
  click(f.controller, '#connect'); await settle();
  expect(root().querySelector('#crm-dialog-title')!.textContent).toBe('Awaiting confirmation');
  expect(f.crm.mock.calls.map(([, input]) => input.operation)).toEqual(['check']);
  await jest.advanceTimersByTimeAsync(1600);
  expect(f.crm.mock.calls.map(([, input]) => input.operation)).toEqual(['check', 'record']);
});

it('tracks nested More-menu Connect after React replaces the trigger and the menu container is clicked', async () => {
  const f = realTrackingFixture(); await settle();
  document.querySelector('#connect')!.remove();
  const more = document.querySelector('#profile button') as HTMLButtonElement; more.id = 'more';
  more.addEventListener('click', () => {
    more.outerHTML = '<button id="more" aria-expanded="true">More</button>';
    document.body.insertAdjacentHTML('beforeend', '<div role="menu" id="portal"><a role="menuitem" href="#" id="nested-connect"><div><svg id="connect-icon"></svg><p>Connect</p></div></a></div>');
    document.querySelector('#nested-connect')!.addEventListener('click', event => {
      event.preventDefault(); // mock LinkedIn route handling, never the extension
      document.querySelector('#portal')!.remove();
      const modal = dialog();
      modal.querySelector('#send')!.addEventListener('click', () => { modal.remove(); document.querySelector('#more')!.insertAdjacentHTML('beforebegin', currentLinkedinPendingLink()); });
    });
  });
  click(f.controller, '#more');
  click(f.controller, '#portal'); // harmless click in the open menu must retain ownership
  click(f.controller, '#connect-icon'); await settle();
  expect(document.querySelector('#send')).not.toBeNull();
  click(f.controller, '#send'); await settle();
  await jest.advanceTimersByTimeAsync(1800);
  expect(f.crm.mock.calls.map(([, input]) => input.operation)).toEqual(['check', 'record']);
  expect(root().querySelector('#crm-dialog-title')!.textContent).toBe('Sent');
});

it.each([false, true])('does not let a late availability response erase a send (quiet refresh: %s)', async quiet => {
  const old = deferred<any>();
  const f = fixture(); await settle();
  f.request.mockReturnValueOnce(old.promise);
  const refreshing = f.controller.refresh(false, quiet);
  document.querySelector('#connect')!.addEventListener('click', () => { document.querySelector('#connect')!.textContent = 'Pending'; });
  click(f.controller, '#connect'); await settle();
  old.resolve({ check }); await refreshing;
  await jest.advanceTimersByTimeAsync(2400);
  expect(f.request.mock.calls.filter(([m]) => m.type === 'page-sent')).toHaveLength(1);
});

it.each(['No account lock', 'CRM signed out', 'Account unavailable', 'Another invitation needs review'])('keeps LinkedIn usable when tracking fails: %s', async reason => {
  const f = fixture(); await settle();
  f.request.mockRejectedValueOnce(new Error(reason));
  const received = jest.fn(); document.querySelector('#connect')!.addEventListener('click', received);
  click(f.controller, '#connect'); await settle();
  expect(received).toHaveBeenCalledTimes(1);
  expect(root().querySelector('.note')!.textContent).toContain('LinkedIn controls remain available');
  expect(f.request.mock.calls.some(([m]) => m.type === 'page-sent')).toBe(false);
});
