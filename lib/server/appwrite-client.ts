import { Client } from 'node-appwrite';

/** The installed SDK allocates a new HTTP dispatcher for every call. On Node's
 * native fetch, omit that override so connections use the native shared pool.
 * Headers/credentials stay on each Client/request; no response or auth is cached. */
export class ServerAppwriteClient extends Client {
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
