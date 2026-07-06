import { isLinkedinProfileField } from "./lead-linkedin-field";

/**
 * Server-enforced required lead fields. The server's
 * `assertRequiredLeadData` rejects create/update requests that are missing
 * any of these fields, regardless of the `required` flag on the form-config
 * document. Mirroring the list here lets the client render a red asterisk
 * next to every field the server will reject, so the asterisks match the
 * actual save-time behaviour instead of drifting with form-config changes.
 */
export const REQUIRED_LEAD_FIELD_KEYS: ReadonlySet<string> = new Set([
  'firstName',
  'lastName',
  'name',
  'legalName',
  'email',
  'phone',
  'visaStatus',
  'linkedinProfileUrl',
  'linkedinProfile',
]);

/**
 * Returns true when the given field key is required by the server, so the
 * client can render the red asterisk for it (even if the form-config says
 * otherwise).
 */
export function isServerRequiredLeadField(key: string): boolean {
  return REQUIRED_LEAD_FIELD_KEYS.has(key);
}

/**
 * Normalizes a source value for comparison: lowercases and strips everything
 * that isn't a letter or digit.
 */
export function normalizeLeadSource(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Whether the field should be marked as required in the UI: true if either
 * the form-config marks it required, or the server requires it — BUT LinkedIn
 * fields are exempt when the lead source is "referral" (the server allows
 * saving without LinkedIn for referral leads). The `source` param defaults to
 * an empty string so callers that don't pass it still get the safe default.
 *
 * The `field` param (optional) is used to detect LinkedIn fields even
 * when the form-config uses a generated key like "field_16".
 */
export function shouldShowRequiredAsterisk(
  fieldKey: string,
  formConfigRequired: boolean | undefined,
  source: unknown = '',
  field?: { key: string; label: string },
): boolean {
  const isReferral = normalizeLeadSource(source) === 'referral';

  // Check if this is a LinkedIn field (uses existing utility which handles legacy keys)
  const isLinkedinField = field
    ? isLinkedinProfileField(field)
    : fieldKey === 'linkedinProfileUrl' || fieldKey === 'linkedinProfile';

  // Referral leads skip the LinkedIn asterisk — the server allows saving
  // without a LinkedIn URL for referral source. This check runs BEFORE the
  // formConfigRequired guard so it overrides even when form-config says required.
  if (isLinkedinField && isReferral) return false;

  if (Boolean(formConfigRequired)) return true;

  return isServerRequiredLeadField(fieldKey);
}
