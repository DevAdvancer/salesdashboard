/**
 * Structured error class for lead server actions.
 *
 * Carries a machine-readable `code` and an optional `field` (a FormField.key)
 * so the client can map the error to a specific form input and render an
 * inline, field-level error rather than a generic toast.
 *
 * Important: Next.js serialises thrown errors when they cross the RSC
 * boundary. The class identity is lost on the client, but the `name`,
 * `message`, and own enumerable properties (`code`, `field`, `meta`) ARE
 * preserved. Detect the error on the client by `name === 'LeadActionError'`
 * (not `instanceof`) — see `lib/utils/lead-action-error.ts`.
 *
 * Also: the outer try/catch in a server action MUST re-throw a
 * LeadActionError as-is. Wrapping it in `new Error(error.message || …)`
 * strips these custom properties and triggers the production
 * "Server Components render" digest mask, defeating the purpose of this
 * class.
 */

export type LeadActionErrorCode =
  | 'MISSING_REQUIRED_FIELD'
  | 'DUPLICATE_FIELD'
  | 'INVALID_STATUS_TRANSITION'
  | 'PERMISSION_DENIED'
  | 'INVALID_INPUT'
  | 'NOT_FOUND'
  | 'UNAUTHORIZED'
  | 'UNKNOWN';

export interface LeadActionErrorOptions {
  /** A `FormField.key` identifying the form input that should be highlighted. */
  field?: string;
  /** Optional metadata (e.g. existing lead id for duplicates, transition context). */
  meta?: Record<string, unknown>;
  /** The underlying error, preserved via the standard Error `cause` chain. */
  cause?: unknown;
}

export class LeadActionError extends Error {
  public readonly name = 'LeadActionError';
  public readonly code: LeadActionErrorCode;
  public readonly field?: string;
  public readonly meta?: Record<string, unknown>;

  constructor(
    code: LeadActionErrorCode,
    message: string,
    options?: LeadActionErrorOptions,
  ) {
    super(message);
    this.code = code;
    this.field = options?.field;
    this.meta = options?.meta;
    if (options?.cause !== undefined) {
      (this as { cause?: unknown }).cause = options.cause;
    }
  }
}
