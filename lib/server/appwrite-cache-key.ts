import { createHmac } from 'node:crypto';

/** Opaque process-local cache identity, bound to the deployment and API key.
 * The API key keys the MAC; it is never serialized into the cached identity.
 * This is cache partitioning, not password storage or an authorization proof.
 */
export function appwriteCacheKey(scope: string, ...parts: unknown[]): string {
  return createHmac('sha256', process.env.APPWRITE_API_KEY || '')
    .update(JSON.stringify([scope, process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT,
      process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID, ...parts]))
    .digest('hex');
}
