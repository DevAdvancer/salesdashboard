import type { ExtensionCheck, ExtensionRecord } from "crm-shared/types/linkedin-extension";
import type { PageMessage, PageStatus, TrackingAttempt } from "./page-tracking";
import { invitationAction, invitationDialog, openedProfileMenu, pendingOnProfile, profileCard, profileMenuContains, profileUrl, type ProfileMenuContext } from "./linkedin-page-dom";
import { profileStatusLabel } from './profile-status';
import { ProfileChangedError } from './page-context';

const statusText = (check: ExtensionCheck) => ({
  new: check.knownToCrm ? "This profile is available for the locked company. Your sent invitation will be recorded automatically."
    : "This profile was not found in CRM. Send your invitation on LinkedIn; it will be recorded automatically.",
  existing_lead: "This profile already exists as a CRM lead. CRM will not add another request.",
  active_request: "An active CRM request already exists for this company. CRM will not add another request.",
  resend_available: "A withdrawn CRM request exists. Confirm below before sending a new invitation.",
  limit_reached: "Daily CRM limit reached. Unlock and deliberately select another account in LinkedIn Helper.",
  missing_limit: "The locked account has no configured limit. Ask your team lead.",
})[check.state];

export class LinkedinPageController {
  private targetUrl = "";
  private check: ExtensionCheck | null = null;
  private attempt: TrackingAttempt | null = null;
  private busy = false;
  private observing = false;
  private resumed = false;
  private menu: ProfileMenuContext | null = null;
  private preparing = false;
  private cancelledWhilePreparing = false;
  private statusSequence = 0;
  private backgroundStatus = false;
  private host: HTMLElement | null = null;
  private root: ShadowRoot | null = null;
  private note = "Checking CRM…";
  private tone = "info";
  private confirmResend = false;
  private generation = 0;
  private sawDialog = false;
  private loadedFor = "";
  private pendingSince = 0;
  private submitted = false;
  private detailsOpen = false;
  private retryAt = 0;
  private failures = 0;
  private recoveryConfirmed = false;
  private wakeTimer: number | null = null;
  private confirmationTimer: number | null = null;

  constructor(private request: <T>(message: PageMessage) => Promise<T>, private currentProfile = profileUrl) {}

  start() {
    // Observe before LinkedIn updates the DOM. Never cancel, delay, or replay its events.
    window.addEventListener("click", this.onClick, { capture: true, passive: true });
    window.addEventListener("keydown", this.onKey, { capture: true, passive: true });
    window.addEventListener('focus', this.onFocus);
    document.addEventListener('visibilitychange', this.onFocus);
    const timer = window.setInterval(() => { void this.tick(); }, 400);
    const observer = new MutationObserver(() => {
      if (this.wakeTimer !== null) return;
      this.wakeTimer = window.setTimeout(() => { this.wakeTimer = null; void this.tick(); }, 50);
    });
    observer.observe(document, { subtree: true, childList: true, characterData: true, attributes: true,
      attributeFilter: ['class', 'style', 'hidden', 'aria-label', 'aria-hidden', 'href', 'role'] });
    void this.tick();
    return () => {
      window.clearInterval(timer);
      observer.disconnect();
      if (this.wakeTimer !== null) window.clearTimeout(this.wakeTimer);
      if (this.confirmationTimer !== null) window.clearTimeout(this.confirmationTimer);
      this.wakeTimer = null; this.confirmationTimer = null;
      window.removeEventListener("click", this.onClick, true);
      window.removeEventListener("keydown", this.onKey, true);
      window.removeEventListener('focus', this.onFocus);
      document.removeEventListener('visibilitychange', this.onFocus);
      this.generation++;
      this.targetUrl = '';
      this.host?.remove();
    };
  }

  private onFocus = () => {
    if (document.visibilityState === 'hidden' || this.busy || (this.attempt && this.observing && !this.resumed)) return;
    void this.refresh(false, true);
  };

  private onKey = (event: KeyboardEvent) => {
    if (event.key === "Enter" && invitationDialog()?.contains(event.target as Node) &&
      (!(event.target instanceof HTMLTextAreaElement) || event.ctrlKey || event.metaKey) &&
      event.isTrusted && (this.preparing || this.attempt) && !this.resumed) this.submitted = true;
  };

  onClick = (event: MouseEvent) => {
    const url = this.currentProfile();
    if (!url || !event.isTrusted) return;
    if (url !== this.targetUrl) void this.tick();
    const opened = openedProfileMenu(event.target, url);
    if (opened) { this.menu = opened; return; }
    const { action, button } = invitationAction(event.target, url, (!!this.attempt || this.preparing) && !this.resumed, this.menu);
    if (!action || !button) { if (!profileMenuContains(event.target, url, this.menu)) this.menu = null; return; }
    if (action === "cancel") {
      this.cancelledWhilePreparing = this.preparing;
      if (this.attempt && this.observing && !this.busy) void this.cancel();
      return;
    }
    if (action === "unsupported") { this.menu = null; return; }
    if (this.resumed) return;
    if (action === 'send') {
      this.submitted = true; this.sawDialog = true;
      return;
    }
    if (!this.preparing && !this.attempt) void this.beginTracking(url);
  };

  private async beginTracking(url: string) {
    if (pendingOnProfile(url, this.menu)) return;
    if (this.check?.state === "resend_available" && !this.confirmResend) {
      this.detailsOpen = true;
      this.show("Confirm the withdrawn request below before sending so CRM can record the resend. LinkedIn controls remain available.", "warning"); return;
    }
    this.statusSequence++;
    this.backgroundStatus = false;
    this.preparing = true; this.busy = true; this.cancelledWhilePreparing = false;
    this.sawDialog = false; this.submitted = false; this.pendingSince = 0;
    const version = this.generation;
    this.show("Tracking this invitation. Continue on LinkedIn; CRM will record it after confirmation.", "info");
    try {
      const data = await this.request<PageStatus>({ type: "page-prepare", targetUrl: url, confirmResend: this.confirmResend });
      if (version !== this.generation || this.currentProfile() !== url || this.cancelledWhilePreparing) {
        if (data.attempt) await this.request({ type: "page-cancel", targetUrl: url, attemptId: data.attempt.id });
        return;
      }
      if (!data.attempt || !data.check.canRecord) throw new Error("CRM cannot track this invitation. Review the profile in CRM.");
      this.check = data.check; this.attempt = data.attempt; this.observing = true;
      this.resumed = false;
      this.show("Waiting for LinkedIn to confirm the invitation. Closing a dialog does not record a request.", "info");
    } catch (error) {
      if (version === this.generation && this.currentProfile() === url) {
        const navigating = error instanceof ProfileChangedError;
        this.detailsOpen = !navigating;
        if (navigating) { this.check = null; this.loadedFor = ''; this.retryAt = Date.now() + 400; }
        this.show(`CRM tracking unavailable. ${error instanceof Error ? error.message : "Review this invitation in CRM."} LinkedIn controls remain available.`, navigating ? 'info' : 'blocked');
      }
    }
    finally { if (version === this.generation) { this.preparing = false; this.busy = false; this.render(); void this.tick(); } }
  }

  async refresh(fresh = false, quiet = false) {
    const url = this.currentProfile();
    if (url !== this.targetUrl) { await this.tick(); return; }
    if (!url || this.busy) return;
    const version = this.generation;
    const sequence = ++this.statusSequence;
    this.busy = true;
    this.backgroundStatus = quiet && !!this.check;
    this.loadedFor = url;
    if (!quiet) { this.confirmResend = false; this.show("Checking CRM…", "info"); }
    try {
      const data = await this.request<PageStatus>({ type: "page-status", targetUrl: url, ...(fresh ? { fresh: true } : {}) });
      if (version !== this.generation || sequence !== this.statusSequence || this.currentProfile() !== url) return;
      if (data.check.targetUrl !== url) throw new ProfileChangedError();
      this.failures = 0; this.retryAt = 0;
      if (this.check?.revision !== data.check.revision) this.confirmResend = false;
      this.check = data.check;
      const owned = data.attempt?.id === this.attempt?.id && this.observing && !this.resumed;
      this.attempt = data.attempt || null;
      this.resumed = !!data.attempt && !owned;
      if (!data.attempt) this.observing = false;
      this.show(data.attempt ? owned ? "Waiting for LinkedIn’s Pending confirmation."
        : data.attempt.targetUrl !== url ? `Another profile has an unfinished invitation: ${data.attempt.targetUrl}. Return to its original tab to review it.`
        : "An invitation was interrupted. If you sent it from the locked account and LinkedIn shows Pending, confirm below to record it in CRM."
        : statusText(data.check), owned ? "info" : data.attempt || !data.check.canRecord ? "blocked" : data.check.state === "resend_available" ? "warning" : "ready");
    } catch (error) {
      if (version === this.generation && sequence === this.statusSequence && this.currentProfile() === url) {
        this.loadedFor = '';
        const navigating = error instanceof ProfileChangedError;
        this.retryAt = Date.now() + (navigating ? 400 : Math.min(30_000, 2000 * 2 ** this.failures++));
        this.check = null;
        this.show(error instanceof Error ? error.message : "CRM tracking is unavailable. LinkedIn controls remain available.", navigating ? 'info' : 'blocked');
      }
    } finally { if (version === this.generation && sequence === this.statusSequence) { this.busy = false; this.backgroundStatus = false; this.render(); } }
  }

  private async cancel() {
    const attempt = this.attempt;
    if (!attempt) return;
    const version = this.generation;
    this.observing = false; this.busy = true;
    try {
      await this.request({ type: "page-cancel", targetUrl: attempt.targetUrl, attemptId: attempt.id });
      if (version !== this.generation) return;
      this.attempt = null;
      this.show("Invitation cancelled. No CRM request was recorded.", "info");
    } catch { if (version === this.generation) this.show("Review the tracking attempt in LinkedIn Helper before continuing.", "blocked"); }
    finally { if (version === this.generation) { this.busy = false; this.render(); } }
  }

  private async tick() {
    const url = this.currentProfile();
    if (url !== this.targetUrl) {
      if (this.confirmationTimer !== null) window.clearTimeout(this.confirmationTimer);
      this.confirmationTimer = null;
      this.generation++; this.targetUrl = url;
      this.check = null; this.attempt = null; this.observing = false; this.resumed = false; this.confirmResend = false;
      this.loadedFor = ""; this.pendingSince = 0; this.submitted = false;
      this.recoveryConfirmed = false;
      this.menu = null; this.preparing = false; this.cancelledWhilePreparing = false;
      this.busy = false; this.backgroundStatus = false; this.retryAt = 0; this.failures = 0; this.detailsOpen = false;
      this.note = 'Checking CRM…'; this.tone = 'info';
      this.host?.remove(); this.host = null; this.root = null;
      // Navigation during a send leaves its worker attempt for explicit review.
      if (url) await this.refresh();
    }
    if (!url) return;
    if (this.loadedFor !== url && !this.busy && Date.now() >= this.retryAt) await this.refresh();
    if (!this.host?.isConnected && document.body) this.render();
    // Pending can stabilize while CRM prepares the attempt. Do not add another
    // 1.6-second wait after that network request completes.
    if (this.preparing) {
      if (this.pendingVisible(url)) this.rememberPending();
      else this.pendingSince = 0;
    }
    if (this.attempt && this.resumed && !this.busy && this.attempt.targetUrl === url) {
      if (this.pendingVisible(url)) this.rememberPending();
      else this.pendingSince = 0;
      this.render();
    }
    if (!this.attempt || !this.observing || this.busy || this.resumed) return;
    if (this.currentProfile() !== this.attempt.targetUrl) return;
    await this.observeAttempt(url, this.attempt);
  }

  private async observeAttempt(url: string, attempt: TrackingAttempt) {
    const dialog = invitationDialog();
    if (dialog) this.sawDialog = true;
    if (attempt.expiresAt < Date.now()) {
      this.observing = false; this.resumed = true;
      this.show("CRM could not recognize LinkedIn’s confirmation in time. If this profile shows Pending, confirm the sending account below to recover the CRM record. LinkedIn controls remain available.", "blocked");
      return;
    }
    // A Pending transition on this profile after an observed user click is required.
    // An existing Pending button, an unrelated toast, or merely closing the dialog is insufficient.
    const pending = !dialog && pendingOnProfile(url, this.menu);
    if (!pending) this.pendingSince = 0;
    if (pending) {
      if (!this.pendingSince) { this.rememberPending(); return; }
      if (Date.now() - this.pendingSince < 1600) return;
      const failed = Array.from(document.querySelectorAll("[role='alert']")).some(item => /unable to|couldn.t|failed|try again|limit reached/i.test(item.textContent || ""));
      if (failed) { this.show("LinkedIn reported an error. No request was recorded; review this invitation.", "blocked"); return; }
      await this.saveConfirmed(url, attempt);
    } else if (this.sawDialog && !dialog && !this.submitted && profileCard(url)) {
      this.pendingSince = 0;
      await this.cancel();
    } else if (this.sawDialog && !dialog && profileCard(url)) {
      this.pendingSince = 0;
      // Allow async LinkedIn rendering time before calling a closed dialog cancelled.
      this.show("Waiting for LinkedIn’s Pending confirmation. If you cancelled, no request will be recorded.", "info");
    }
  }

  private pendingVisible(url: string) {
    return !invitationDialog() && pendingOnProfile(url, this.menu) && !Array.from(document.querySelectorAll("[role='alert']"))
      .some(item => /unable to|couldn.t|failed|try again|limit reached/i.test(item.textContent || ""));
  }

  private rememberPending() {
    if (this.pendingSince) return;
    this.pendingSince = Date.now();
    if (this.confirmationTimer !== null) window.clearTimeout(this.confirmationTimer);
    // Wake exactly at the stability deadline instead of waiting for the next poll.
    this.confirmationTimer = window.setTimeout(() => { this.confirmationTimer = null; void this.tick(); }, 1600);
  }

  private async recover() {
    const attempt = this.attempt;
    const url = this.currentProfile();
    if (!attempt || attempt.state !== 'armed' || this.busy || !this.resumed || !this.recoveryConfirmed ||
      url !== attempt.targetUrl || !this.pendingSince || Date.now() - this.pendingSince < 1600 || !this.pendingVisible(url)) return;
    await this.saveConfirmed(url, attempt, true);
  }

  private async saveConfirmed(url: string, attempt: TrackingAttempt, recovery = false) {
    const version = this.generation;
    this.observing = false; this.busy = true;
    this.show("LinkedIn invitation confirmed. Saving to CRM…", "info");
    try {
      const saved = await this.request<ExtensionRecord>(recovery
        ? { type: "page-recover", targetUrl: url, attemptId: attempt.id, confirmedPending: true }
        : { type: "page-sent", targetUrl: url, attemptId: attempt.id });
      if (version !== this.generation || this.currentProfile() !== url) return;
      this.attempt = null; this.check = saved; this.resumed = false;
      this.show(saved.mode === "existing" ? "No new CRM request was added. Check this profile in CRM."
        : `Request recorded from ${saved.account.name}. ${saved.remaining ?? "?"} requests remaining today.`, saved.mode === "existing" ? "blocked" : "success");
    } catch (error) {
      if (version !== this.generation || this.currentProfile() !== url) return;
      this.resumed = true;
      // A rejected/lost write response must not offer a second save from this controller.
      this.attempt = { ...attempt, state: 'uncertain' };
      this.show(`LinkedIn sent the invitation, but CRM recording needs review. ${error instanceof Error ? error.message : "Open CRM before retrying."}`, "blocked");
    } finally { if (version === this.generation) { this.busy = false; this.render(); } }
  }

  private show(note: string, tone: string) {
    if (tone === 'success') this.detailsOpen = false;
    this.note = note; this.tone = tone; this.render();
  }

  private render() {
    if (!document.body || !this.targetUrl) return;
    if (this.host && !this.host.isConnected) { this.host = null; this.root = null; }
    if (!this.host) {
      this.host = document.createElement("div");
      this.host.id = "crm-hub-linkedin-status";
      this.host.style.cssText = "position:fixed;right:20px;bottom:88px;z-index:2147483646;width:max-content;max-width:calc(100vw - 32px)";
      this.root = this.host.attachShadow({ mode: "open" });
      this.root.innerHTML = `<style>
        :host{color-scheme:light;font:13px/1.5 system-ui,sans-serif;color:#17212e}
        *{box-sizing:border-box}[hidden]{display:none!important}.card{background:#fff;border:1px solid #d7dde4;border-radius:22px;box-shadow:0 3px 14px #0002;max-width:100%}
        .card[data-tone=ready],.card[data-tone=success]{background:#f0fdf4;border-color:#16a34a;color:#166534}
        .card[data-tone=blocked]{background:#fef2f2;border-color:#dc2626;color:#991b1b}
        .card[data-tone=warning]{background:#fffbeb;border-color:#eab308;color:#854d0e}
        .status-row{display:flex;align-items:center;gap:8px;padding:7px 12px;min-height:36px;max-width:100%;white-space:nowrap}
        .brand{font-size:10px;font-weight:800;letter-spacing:.04em}.dot{width:6px;height:6px;border-radius:50%;background:currentColor;flex-shrink:0}
        #crm-dialog-title{font-weight:650;overflow:hidden;text-overflow:ellipsis}.remaining{font-size:11px;opacity:.8}
        #details-toggle{padding:0;border:0;background:transparent;color:inherit;text-align:left;display:flex;align-items:center;gap:8px;min-width:0}
        #details{width:300px;max-width:calc(100vw - 58px);padding:0 12px 12px}.card:has(#details:not([hidden])){border-radius:16px}
        p{margin:8px 0;overflow-wrap:anywhere}.account{font-size:12px}
        button{font:inherit;cursor:pointer;border:1px solid #c4ced8;border-radius:6px;background:#fff;padding:5px 9px;color:#17212e}
        button:disabled{opacity:.5;cursor:wait}label{display:block;font-size:12px;margin:8px 0}.hint{font-size:11px;opacity:.85}.actions{display:flex;gap:8px}
      </style><section class="card" aria-label="CRM profile status">
        <div class="status-row"><span class="brand">CRM HUB</span><span class="dot" aria-hidden="true"></span>
          <button id="details-toggle" type="button" aria-expanded="false" aria-controls="details" aria-label="Show CRM status details">
            <span id="crm-dialog-title" role="status" aria-live="polite"></span><span class="remaining"></span><span aria-hidden="true">⌄</span>
          </button></div>
        <div id="details" hidden><p class="account"></p><p class="note"></p>
        <label hidden><input type="checkbox"> I want to send a new invitation for this withdrawn CRM request.</label>
        <div id="recovery" hidden><label><input id="recovery-confirm" type="checkbox"> <span id="recovery-account"></span></label>
        <button id="recover" type="button">Record confirmed invitation</button></div>
        <div class="actions"><button id="continue" type="button">Continue on LinkedIn</button><button id="refresh" type="button">Recheck</button></div>
        <p class="hint">To change accounts, open LinkedIn Helper and unlock. Keep your signed-in CRM tab open.</p>
        </div></section>`;
      this.root.querySelector("#refresh")!.addEventListener("click", () => { void this.refresh(true); });
      this.root.querySelector('#continue')!.addEventListener('click', () => { this.detailsOpen = false; this.render(); });
      this.root.querySelector('#details-toggle')!.addEventListener('click', () => { this.detailsOpen = !this.detailsOpen; this.render(); });
      this.root.querySelector("input")!.addEventListener("change", event => { this.confirmResend = (event.target as HTMLInputElement).checked; });
      this.root.querySelector('#recovery-confirm')!.addEventListener('change', event => { this.recoveryConfirmed = (event.target as HTMLInputElement).checked; this.render(); });
      this.root.querySelector('#recover')!.addEventListener('click', () => { void this.recover(); });
      document.body.append(this.host);
    }
    const root = this.root!;
    const card = root.querySelector<HTMLElement>(".card")!;
    card.dataset.tone = this.tone;
    root.querySelector<HTMLElement>('#details')!.hidden = !this.detailsOpen;
    const toggle = root.querySelector<HTMLButtonElement>('#details-toggle')!;
    toggle.setAttribute('aria-expanded', String(this.detailsOpen));
    toggle.setAttribute('aria-label', this.detailsOpen ? 'Hide CRM status details' : 'Show CRM status details');
    toggle.title = this.note;
    root.querySelector('#crm-dialog-title')!.textContent = this.tone === 'success' ? 'Sent' : this.preparing ? 'Awaiting confirmation' : this.busy && !this.backgroundStatus ? 'Checking…' :
      this.attempt ? (this.resumed ? 'Needs review' : 'Awaiting confirmation') : this.check && (this.tone === 'ready' || this.tone === 'warning' || !this.check.canRecord)
        ? profileStatusLabel(this.check) : this.tone === 'blocked' ? 'CRM tracking unavailable' : this.check ? profileStatusLabel(this.check) : 'Checking…';
    root.querySelector('.remaining')!.textContent = this.check ? `· ${this.check.remaining ?? '?'} left` : '';
    root.querySelector(".note")!.textContent = this.note;
    root.querySelector(".note")!.setAttribute("data-tone", this.tone);
    const account = root.querySelector<HTMLElement>('.account')!;
    account.hidden = !this.check;
    account.textContent = this.check ? `Locked: ${this.check.account.company} · ${this.check.account.name} · ${this.check.remaining ?? "?"} left` : '';
    (root.querySelector("#refresh") as HTMLButtonElement).disabled = this.busy || !!this.attempt;
    const continueButton = root.querySelector<HTMLButtonElement>("#continue")!;
    continueButton.hidden = this.tone === "blocked";
    continueButton.textContent = this.tone === "success" ? "Done" : "Continue on LinkedIn";
    (root.querySelector("label") as HTMLLabelElement).hidden = this.check?.state !== "resend_available" || !!this.attempt;
    (root.querySelector("input") as HTMLInputElement).checked = this.confirmResend;
    const recoverable = this.resumed && this.attempt?.state === 'armed' && this.attempt.targetUrl === this.targetUrl;
    root.querySelector<HTMLElement>('#recovery')!.hidden = !recoverable;
    root.querySelector('#recovery-account')!.textContent = `I sent this invitation using ${this.check?.account.name || 'the locked account'} (${this.check?.account.company || ''}) and LinkedIn shows Pending.`;
    root.querySelector<HTMLInputElement>('#recovery-confirm')!.checked = this.recoveryConfirmed;
    root.querySelector<HTMLButtonElement>('#recover')!.disabled = this.busy || !this.recoveryConfirmed || !this.pendingSince || Date.now() - this.pendingSince < 1600;
  }
}
