import type { ExtensionBootstrap, ExtensionCheck, ExtensionInput, ExtensionResponse } from "crm-shared/types/linkedin-extension";

type ReadData = ExtensionBootstrap | ExtensionCheck;
interface Entry { origin: string; key: string; expiresAt: number; data: ReadData }
interface SessionStore { load(): Promise<Entry[]>; save(entries: Entry[]): Promise<void> }
type FetchCrm = (origin: string, input?: ExtensionInput) => Promise<ExtensionResponse<ReadData>>;
const TTL = 30_000;
const MAX_ENTRIES = 40;

/** Worker-owned reads outlive popup instances; session storage survives worker suspension. */
export class CrmReadCoordinator {
  private entries = new Map<string, Entry>();
  private reads = new Map<string, Promise<ExtensionResponse<ReadData>>>();
  private writes = new Map<string, Promise<ExtensionResponse<ReadData>>>();
  private generations = new Map<string, number>();
  private ready: Promise<void>;
  private persistence = Promise.resolve();

  constructor(private store: SessionStore, private fetchCrm: FetchCrm, private now = Date.now) {
    this.ready = store.load().then(entries => {
      for (const entry of entries.slice(-MAX_ENTRIES)) {
        if (entry.expiresAt > this.now()) this.entries.set(entry.key, entry);
      }
    }).catch(() => { /* Memory-only reuse still works if session storage is unavailable. */ });
  }

  async invalidate(origin: string) {
    await this.ready;
    this.generations.set(origin, (this.generations.get(origin) || 0) + 1);
    for (const [key, entry] of this.entries) if (entry.origin === origin) this.entries.delete(key);
    // A new read must not join a request started before navigation or a save.
    for (const key of this.reads.keys()) if (key.startsWith(`${origin}|`)) this.reads.delete(key);
    await this.persist();
  }

  async request(origin: string, input?: ExtensionInput, fresh = false): Promise<ExtensionResponse<ReadData>> {
    await this.ready;
    if (input?.operation === "record") return this.record(origin, input);
    const write = this.writes.get(origin);
    if (write) await write; // Reopening while saving must not restore the pre-save result.
    const key = this.key(origin, input);
    const pending = this.reads.get(key);
    if (pending) return pending;
    const cached = this.entries.get(key);
    if (!fresh && cached && cached.expiresAt > this.now()) return { ok: true, data: cached.data };
    const generation = this.generations.get(origin) || 0;
    const work = this.fetchCrm(origin, input).then(async response => {
      if (generation !== (this.generations.get(origin) || 0)) return response;
      if (!response.ok) {
        this.entries.delete(key);
        if (response.status === 401 || response.status === 403) await this.invalidate(origin);
        else await this.persist();
      } else if (response.data) {
        // Any response for another login invalidates the previous user's bootstrap and history.
        const previous = this.entries.get(this.key(origin));
        if (previous && previous.data.user.id !== response.data.user.id) await this.invalidate(origin);
        this.put(origin, key, response.data);
        await this.persist();
      }
      return response;
    }).finally(() => { if (this.reads.get(key) === work) this.reads.delete(key); });
    this.reads.set(key, work);
    return work;
  }

  private record(origin: string, input: ExtensionInput): Promise<ExtensionResponse<ReadData>> {
    if (this.writes.has(origin)) return Promise.resolve({ ok: false, status: 409, error: "A save is already running. Check history after it finishes." });
    const work = (async () => {
      await this.invalidate(origin);
      try { return await this.fetchCrm(origin, input); }
      finally { await this.invalidate(origin); }
    })().finally(() => { if (this.writes.get(origin) === work) this.writes.delete(origin); });
    this.writes.set(origin, work);
    return work;
  }

  private key(origin: string, input?: ExtensionInput) {
    return `${origin}|${input ? JSON.stringify([input.operation, input.accountId, input.targetUrl]) : "bootstrap"}`;
  }

  private put(origin: string, key: string, data: ReadData) {
    this.entries.delete(key);
    this.entries.set(key, { origin, key, data, expiresAt: this.now() + TTL });
    while (this.entries.size > MAX_ENTRIES) this.entries.delete(this.entries.keys().next().value!);
  }

  private persist() {
    const entries = [...this.entries.values()].filter(entry => entry.expiresAt > this.now());
    this.persistence = this.persistence.then(() => this.store.save(entries)).catch(() => {});
    return this.persistence;
  }
}
