import { Client } from 'node-appwrite';

/** The installed SDK allocates a new HTTP dispatcher for every call. On Node's
 * native fetch, omit that override so connections use the native shared pool.
 * Headers/credentials stay on each Client/request; no response or auth is cached. */
export class ServerAppwriteClient extends Client {
  /** The SDK stores added headers in lowercase beside its mixed-case defaults, so
   * both were sent and Appwrite kept the default 1.6.0 response format (which has
   * no `impersonator` field). Replace any default spelled differently. */
  override addHeader(header: string, value: string) {
    for (const key of Object.keys(this.headers)) if (key.toLowerCase() === header.toLowerCase()) delete this.headers[key];
    this.headers[header] = value;
    return this;
  }
  override prepareRequest(...args: Parameters<Client['prepareRequest']>) {
    const prepared = super.prepareRequest(...args);
    if (!this.config.selfSigned && typeof globalThis.fetch === 'function') {
      const options = prepared.options as RequestInit & { dispatcher?: unknown; agent?: unknown };
      delete options.dispatcher;
      delete options.agent;
    }
    // Explicit self-signed configurations retain the SDK's TLS transport.
    return prepared;
  }
}
