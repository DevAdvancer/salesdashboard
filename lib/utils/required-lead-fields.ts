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
 * Whether the field should be marked as required in the UI: true if either
 * the form-config marks it required, or the server requires it. This keeps
 * the asterisk visible even when form-config is missing a `required: true`
 * flag on a field the server will still reject.
 */
export function shouldShowRequiredAsterisk(
  fieldKey: string,
  formConfigRequired: boolean | undefined,
): boolean {
  return Boolean(formConfigRequired) || isServerRequiredLeadField(fieldKey);
}
