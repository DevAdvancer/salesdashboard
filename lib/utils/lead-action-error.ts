import type { LeadActionErrorCode } from '@/lib/server/lead-errors';

/**
 * The shape returned by `parseLeadActionError` when an error is recognised
 * as a `LeadActionError` that crossed the RSC boundary. Use the `field`
 * to highlight a specific form input, and the `code` to branch UI behavior
 * (e.g. show a duplicate banner for `DUPLICATE_FIELD`).
 */
export interface ParsedLeadActionError {
  code: LeadActionErrorCode;
  field?: string;
  message: string;
  isLeadActionError: true;
}

/**
 * Recognise errors thrown from lead server actions on the client.
 *
 * On the client, the Error class identity is lost across the RSC boundary;
 * only the `name`, `message`, and own enumerable properties are preserved.
 * Detection therefore relies on `name === 'LeadActionError'` and the
 * presence of a `code` string property, not `instanceof`. Returns `null`
 * when the error isn't a `LeadActionError`, so callers can fall back to
 * the existing `getErrorMessage` / generic-toast path.
 */
export function parseLeadActionError(
  error: unknown,
): ParsedLeadActionError | null {
  if (!error || typeof error !== 'object') return null;
  const e = error as Record<string, unknown>;
  if (e.name !== 'LeadActionError' || typeof e.code !== 'string') return null;
  return {
    code: e.code as LeadActionErrorCode,
    field: typeof e.field === 'string' ? e.field : undefined,
    message:
      typeof e.message === 'string' && e.message.length > 0
        ? e.message
        : 'An error occurred',
    isLeadActionError: true,
  };
}
