import { normalizeProfileUrl } from "crm-shared/utils/linkedin-extension-url";
import { getCurrentEasternIsoDate } from "crm-shared/utils/eastern-date";
import type { ExtensionBootstrap, ExtensionCheck, ExtensionInput, ExtensionRecord } from "crm-shared/types/linkedin-extension";

export interface TrackingLock { origin: string; userId: string; accountId: string }
export interface TrackingAttempt extends TrackingLock {
  id: string; tabId: number; targetUrl: string; revision: string; confirmResend: boolean;
  expiresAt: number; state: "armed" | "saving" | "uncertain";
}
export type PageMessage = { type: "page-status" | "page-prepare"; targetUrl: string; confirmResend?: boolean; fresh?: boolean } |
  { type: "page-sent" | "page-cancel" | "page-validate"; targetUrl: string; attemptId: string } |
  { type: "page-recover"; targetUrl: string; attemptId: string; confirmedPending: true };
export interface PageStatus { check: ExtensionCheck; attempt?: TrackingAttempt }
export interface TrackingPreview { lock: TrackingLock; targetUrl: string; day: string; expiresAt: number; check: ExtensionCheck }
type PreviewResult = { lock: TrackingLock; check: ExtensionCheck };
interface PreviewEntry extends Omit<TrackingPreview, 'check'> { check?: ExtensionCheck; result: Promise<PreviewResult> }
const PREVIEW_TTL = 5 * 60_000;
const MAX_PREVIEWS = 100;
const previewKey = (lock: TrackingLock, targetUrl: string) => JSON.stringify([lock.origin, lock.userId, lock.accountId, targetUrl]);
export interface TrackingStore {
  lock(): Promise<TrackingLock | null>;
  setLock(lock: TrackingLock | null): Promise<void>;
  attempts(): Promise<TrackingAttempt[]>;
  saveAttempts(attempts: TrackingAttempt[]): Promise<void>;
  previews?(): Promise<TrackingPreview[]>;
  savePreviews?(previews: TrackingPreview[]): Promise<void>;
}
export type TrackingRequest = <T>(origin: string, input?: ExtensionInput) => Promise<T>;

/** Mutations are serialized in the worker; read-only status checks may run independently. */
export class PageTracking {
  private queue: Promise<unknown> = Promise.resolve();
  private ready: Promise<void>;
  private previewPersistence = Promise.resolve();
  private previews = new Map<string, PreviewEntry>();
  private generations = new Map<string, number>();
  constructor(private store: TrackingStore, private request: TrackingRequest,
    private now = () => Date.now(), private id = () => crypto.randomUUID()) {
    // A worker that was suspended during a save cannot assume that save failed.
    this.ready = store.attempts().then(async attempts => {
      if (attempts.some(item => item.state === "saving")) {
        await store.saveAttempts(attempts.map(item => item.state === "saving" ? { ...item, state: "uncertain" } : item));
      }
      const saved = await store.previews?.().catch(() => []) || [];
      const day = getCurrentEasternIsoDate(new Date(this.now()));
      for (const item of saved.slice(-MAX_PREVIEWS)) {
        if (!item?.lock?.origin || item.day !== day || item.expiresAt <= this.now() ||
          item.check?.user?.id !== item.lock.userId || item.check?.account?.id !== item.lock.accountId || item.check?.targetUrl !== item.targetUrl) continue;
        this.previews.set(previewKey(item.lock, item.targetUrl), { ...item, result: Promise.resolve({ lock: item.lock, check: item.check }) });
      }
    });
  }

  run<T>(operation: () => Promise<T>): Promise<T> {
    const task = this.queue.then(operation);
    this.queue = task.catch(() => {});
    return task;
  }

  async configure(origin: string, accountId: string | null): Promise<TrackingLock | null> {
    await this.ready;
    if ((await this.store.attempts()).length) {
      throw new Error("Finish or review the pending invitation on LinkedIn before changing the locked account.");
    }
    await this.invalidate(origin);
    if (!accountId) { await this.store.setLock(null); return null; }
    const data = await this.request<ExtensionBootstrap>(origin);
    const current = await this.store.lock();
    if (current?.origin === origin && current.userId === data.user.id && current.accountId !== accountId) {
      throw new Error("Unlock before selecting another LinkedIn account.");
    }
    const account = data.accounts.find(item => item.id === accountId);
    if (!account || account.remaining === 0 || account.limit === null) {
      throw new Error("Choose an assigned account with a configured, available allowance.");
    }
    const lock = { origin, userId: data.user.id, accountId };
    await this.store.setLock(lock);
    return lock;
  }

  private async checked(origin: string, targetUrl: string) {
    const lock = await this.store.lock();
    if (!lock || lock.origin !== origin) throw new Error("Open LinkedIn Helper and lock the account you are using before sending.");
    const check = await this.request<ExtensionCheck>(origin, { operation: "check", accountId: lock.accountId, targetUrl });
    if (check.user.id !== lock.userId) throw new Error("The CRM user changed. Unlock and select your LinkedIn account again.");
    return { lock, check };
  }

  async invalidate(origin: string) {
    await this.ready;
    this.generations.set(origin, (this.generations.get(origin) || 0) + 1);
    for (const [key, entry] of this.previews) if (entry.lock.origin === origin) this.previews.delete(key);
    return this.persistPreviews();
  }

  private persistPreviews() {
    const items: TrackingPreview[] = [];
    for (const entry of this.previews.values()) if (entry.check && entry.expiresAt > this.now()) {
      const { lock, targetUrl, day, expiresAt, check } = entry;
      items.push({ lock, targetUrl, day, expiresAt, check });
    }
    this.previewPersistence = this.previewPersistence.then(async () => { await this.store.savePreviews?.(items); }).catch(() => {});
    return this.previewPersistence;
  }

  private async preview(origin: string, targetUrl: string, fresh: boolean) {
    const lock = await this.store.lock();
    if (!lock || lock.origin !== origin) throw new Error("Open LinkedIn Helper and lock the account you are using before sending.");
    const key = previewKey(lock, targetUrl);
    const day = getCurrentEasternIsoDate(new Date(this.now()));
    const cached = this.previews.get(key);
    if (cached && cached.day === day && cached.expiresAt > this.now() && (!fresh || !cached.check)) {
      this.previews.delete(key); this.previews.set(key, cached);
      return cached.result;
    }
    // Keep the already running profile check too: Connect must not start a second
    // identical CRM request while availability is still loading.
    const generation = this.generations.get(origin) || 0;
    const result = this.request<ExtensionCheck>(origin, { operation: 'check', accountId: lock.accountId, targetUrl }).then(check => {
      if (generation !== (this.generations.get(origin) || 0)) throw new Error('The CRM context changed. Recheck this profile.');
      if (check.user.id !== lock.userId) throw new Error("The CRM user changed. Unlock and select your LinkedIn account again.");
      if (check.targetUrl !== targetUrl || check.account.id !== lock.accountId) throw new Error('CRM returned a different profile or account. Refresh tracking.');
      return { lock, check };
    });
    const entry: PreviewEntry = { lock, targetUrl, day, expiresAt: this.now() + PREVIEW_TTL, result };
    this.previews.delete(key); this.previews.set(key, entry);
    while (this.previews.size > MAX_PREVIEWS) this.previews.delete(this.previews.keys().next().value!);
    try {
      const value = await result;
      if (this.previews.get(key) === entry) { entry.check = value.check; await this.persistPreviews(); }
      return value;
    }
    catch (error) { if (this.previews.get(key) === entry) this.previews.delete(key); throw error; }
  }

  private async prepare(origin: string, tabId: number, targetUrl: string,
    message: { type: "page-status" | "page-prepare"; confirmResend?: boolean; fresh?: boolean }, attempts: TrackingAttempt[]): Promise<PageStatus> {
    const { lock, check } = await this.preview(origin, targetUrl, message.type === 'page-status' && message.fresh === true);
    if (message.type === "page-status") {
      // Read-only status checks run independently of the mutation queue. Never
      // return an old lock/attempt snapshot after a concurrent save or selection.
      const latest = await this.store.lock();
      if (!latest || latest.origin !== lock.origin || latest.userId !== lock.userId || latest.accountId !== lock.accountId) {
        throw new Error("The locked account changed. Refresh CRM tracking.");
      }
      const pending = (await this.store.attempts()).find(item => item.accountId === lock.accountId && item.origin === origin);
      return { check, ...(pending ? { attempt: pending } : {}) };
    }
    const pending = attempts.find(item => item.accountId === lock.accountId && item.origin === origin);
    const latest = await this.store.lock();
    if (!latest || latest.origin !== lock.origin || latest.userId !== lock.userId || latest.accountId !== lock.accountId) {
      throw new Error('The locked account changed. Refresh CRM tracking.');
    }
    if (pending) throw new Error("An invitation is already being tracked. Finish or review it before sending another.");
    if (!check.canRecord) throw new Error(check.state === "limit_reached" ? "Daily CRM limit reached. Unlock and deliberately select the account you are using." :
      check.state === "existing_lead" ? "This profile already exists as a CRM lead." :
      check.state === "active_request" ? "An active CRM request already exists for this company." : "This account cannot send. Check the CRM configuration.");
    if (check.state === "resend_available" && !message.confirmResend) throw new Error("Confirm the previous withdrawn request before resending.");
    const attempt: TrackingAttempt = { ...lock, id: this.id(), tabId, targetUrl, revision: check.revision,
      confirmResend: check.state === "resend_available" && message.confirmResend === true,
      expiresAt: this.now() + 120_000, state: "armed" };
    await this.store.saveAttempts([...attempts, attempt]);
    return { check, attempt };
  }

  /** The popup shares profile reads, while invitation attempts remain exclusive to their original tab. */
  async readPreview(origin: string, accountId: string, targetUrl: string, fresh = false): Promise<ExtensionCheck | undefined> {
    await this.ready;
    const scope = await this.store.lock();
    if (!scope || scope.origin !== origin || scope.accountId !== accountId) return undefined;
    const { lock, check } = await this.preview(origin, normalizeProfileUrl(targetUrl), fresh);
    const latest = await this.store.lock();
    if (!latest || latest.origin !== lock.origin || latest.userId !== lock.userId || latest.accountId !== lock.accountId) {
      throw new Error('The locked account changed. Refresh CRM tracking.');
    }
    return check;
  }

  async handle(origin: string, tabId: number, message: PageMessage): Promise<PageStatus | ExtensionRecord | { cancelled: true }> {
    await this.ready;
    const targetUrl = normalizeProfileUrl(message.targetUrl);
    const attempts = await this.store.attempts();
    if (message.type === "page-status" || message.type === "page-prepare") {
      return this.prepare(origin, tabId, targetUrl, message, attempts);
    }
    if (!("attemptId" in message)) throw new Error("Invalid tracking operation.");
    const attemptId = message.attemptId;
    const attempt = attempts.find(item => item.id === attemptId && item.tabId === tabId &&
      item.targetUrl === targetUrl && item.origin === origin);
    if (!attempt) throw new Error("No matching invitation is being tracked. Check this profile in CRM.");
    if (message.type === "page-cancel") {
      if (attempt.state === "saving") throw new Error("CRM is still saving this invitation.");
      await this.store.saveAttempts(attempts.filter(item => item.id !== attempt.id));
      return { cancelled: true };
    }
    const recovery = message.type === "page-recover" && message.confirmedPending === true;
    if (message.type === "page-recover" && !recovery) throw new Error("Confirm the sent invitation and locked account before recovering it.");
    if (attempt.state !== "armed" || (!recovery && attempt.expiresAt < this.now())) {
      throw new Error("This invitation needs review. Check CRM before clearing the tracking attempt; it will not be saved twice automatically.");
    }
    const lock = await this.store.lock();
    if (!lock || lock.origin !== origin || lock.accountId !== attempt.accountId || lock.userId !== attempt.userId) {
      throw new Error("The locked account changed. Review this invitation in CRM.");
    }
    if (recovery || message.type === "page-validate") {
      const current = await this.checked(origin, targetUrl);
      if (!current.check.canRecord || current.check.revision !== attempt.revision) {
        throw new Error("CRM history, business date, or allowance changed. Sending is blocked in CRM; review this invitation before recording.");
      }
      if (message.type === "page-validate") {
        attempt.expiresAt = this.now() + 120_000;
        await this.store.saveAttempts(attempts);
        return { check: current.check, attempt };
      }
    }
    // The record endpoint itself freshly authorizes expectedUserId/account, checks
    // allowance/leads/revision and rejects duplicates. A separate check here repeats
    // the full inspection and adds a network round trip without strengthening it.
    attempt.state = "saving";
    await this.store.saveAttempts(attempts);
    await this.invalidate(origin);
    try {
      const saved = await this.request<ExtensionRecord>(origin, { operation: "record", accountId: attempt.accountId,
        targetUrl, revision: attempt.revision, confirmResend: attempt.confirmResend, expectedUserId: attempt.userId });
      if (saved.user.id !== attempt.userId) throw new Error("CRM user changed while saving. Review this invitation in CRM.");
      await this.store.saveAttempts(attempts.filter(item => item.id !== attempt.id));
      return saved;
    } catch (error) {
      attempt.state = "uncertain";
      await this.store.saveAttempts(attempts);
      throw error;
    } finally { await this.invalidate(origin); }
  }

  async clearReviewed(attemptId: string) {
    await this.ready;
    const attempts = await this.store.attempts();
    if (attempts.some(item => item.id === attemptId && item.state === "saving")) throw new Error("Wait for the CRM save to finish.");
    await this.store.saveAttempts(attempts.filter(item => item.id !== attemptId));
  }
}
