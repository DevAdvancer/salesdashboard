/**
 * Helpers for the "Close Lead" button gating.
 *
 * The Close button must stay disabled until Amount, Last Name, and Legal
 * Name are all filled with a real value. "N/A", blank, and whitespace-only
 * inputs are not accepted.
 *
 * Backout is a separate status (the lead is being abandoned, not closed)
 * and intentionally bypasses these checks.
 *
 * `field_15` is a legacy alias for the Amount key used by earlier
 * versions of the form config. We still recognize it on read so the
 * close-time gate accepts values stored under either key.
 */

const LEGACY_AMOUNT_KEYS = ["field_15"] as const;
const NA_LIKE_PATTERN = /^n\/?a$/i;

/**
 * Read the lead's Amount value with a transparent fallback to the legacy
 * `field_15` key. Returns the raw stored value (string, number, or
 * undefined) so the caller can decide how to interpret it.
 */
export function getLeadAmountValue(
  leadData: Record<string, unknown> | undefined | null,
): unknown {
  if (!leadData) return undefined;
  if (leadData.amount !== undefined && leadData.amount !== null) {
    return leadData.amount;
  }
  for (const legacyKey of LEGACY_AMOUNT_KEYS) {
    const legacyValue = (leadData as Record<string, unknown>)[legacyKey];
    if (legacyValue !== undefined && legacyValue !== null) {
      return legacyValue;
    }
  }
  return undefined;
}

export function isAmountMissing(rawValue: unknown): boolean {
  if (rawValue === undefined || rawValue === null) return true;
  if (typeof rawValue === "number") {
    return !Number.isFinite(rawValue);
  }
  if (typeof rawValue === "string") {
    const text = rawValue.trim();
    if (!text) return true;
    if (NA_LIKE_PATTERN.test(text)) return true;
    const numeric = Number(text);
    return !Number.isFinite(numeric);
  }
  return true;
}

export function isTextMissing(rawValue: unknown): boolean {
  if (rawValue === undefined || rawValue === null) return true;
  const text = String(rawValue).trim();
  if (!text) return true;
  return NA_LIKE_PATTERN.test(text);
}

export interface CloseGateInput {
  isClosed: boolean;
  closeStatus: string;
  leadData: Record<string, unknown> | undefined | null;
  isBackoutStatus: (status: string) => boolean;
}

/**
 * Returns `true` when the user is NOT allowed to close the lead because
 * one of Amount / LastName / Legal Name is missing or filled with an
 * "N/A"-like value. Backout is exempt.
 */
export function isCloseRequiredFieldsMissing({
  isClosed,
  closeStatus,
  leadData,
  isBackoutStatus,
}: CloseGateInput): boolean {
  if (isClosed) return false;
  if (isBackoutStatus(closeStatus)) return false;

  const amount = getLeadAmountValue(leadData);
  if (isAmountMissing(amount)) return true;

  if (isTextMissing(leadData?.lastName)) return true;
  if (isTextMissing(leadData?.legalName)) return true;

  return false;
}

/**
 * Lists the missing required fields as human labels, for use in toasts
 * and inline error messages. The order matches the lead form: Amount,
 * Last Name, Legal Name.
 */
export function getMissingCloseRequiredFields(
  leadData: Record<string, unknown> | undefined | null,
): string[] {
  const missing: string[] = [];

  if (isAmountMissing(getLeadAmountValue(leadData))) {
    missing.push("Total Amount to be Paid");
  }
  if (isTextMissing(leadData?.lastName)) {
    missing.push("Last Name");
  }
  if (isTextMissing(leadData?.legalName)) {
    missing.push("Legal Name");
  }

  return missing;
}

/**
 * Returns true when Payment Percentage or Payment Months are missing/
 * blank/N/A in the payment plan values. Used to gate lead closure —
 * no role (including admin/developer/monitor) can close a lead without
 * entering payment details. Backout is exempt.
 */
export function isPaymentDetailsMissing(
  paymentPlanValues: Record<string, unknown>,
  closeStatus: string,
): boolean {
  if (isBackoutStatusInternal(closeStatus)) return false;

  const rawPercent = paymentPlanValues.paymentPercent;
  const rawMonths = paymentPlanValues.paymentMonths;

  return (
    isTextMissing(rawPercent) || isTextMissing(rawMonths)
  );
}

/**
 * Lists the missing payment fields for use in toasts.
 */
export function getMissingPaymentFields(
  paymentPlanValues: Record<string, unknown>,
  closeStatus: string,
): string[] {
  if (isBackoutStatusInternal(closeStatus)) return [];

  const missing: string[] = [];
  const rawPercent = paymentPlanValues.paymentPercent;
  const rawMonths = paymentPlanValues.paymentMonths;

  if (isTextMissing(rawPercent)) missing.push("Payment Percentage");
  if (isTextMissing(rawMonths)) missing.push("Payment Months");

  return missing;
}

/**
 * Internal backout check matching the pattern used in the leads page.
 * Exposed so the page component can share the same logic.
 */
export function isBackoutStatusInternal(value: unknown): boolean {
  const text = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!text) return false;
  return (
    text === "backout" ||
    text === "backedout" ||
    text === "backed out" ||
    text === "back out" ||
    text.replace(/\s+/g, "") === "backedout" ||
    text.replace(/\s+/g, "") === "backout"
  );
}
