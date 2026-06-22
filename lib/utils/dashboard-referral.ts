import type { Lead, LeadRequest } from "@/lib/types";

export interface ReferralSplit {
  nonReferral: { count: number; totalAmount: number };
  referral: { count: number; totalAmount: number };
}

/**
 * Normalizes a source string for matching:
 *  - lowercases
 *  - trims whitespace
 *  - strips everything that isn't a letter or digit
 *
 * So "Referral Form", "referralform", "Referral Form   " all match.
 */
function normalizeSource(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

const REFERRAL_SOURCE_NORMALIZED = "referral";

function isReferralSource(source: unknown): boolean {
  return normalizeSource(source) === REFERRAL_SOURCE_NORMALIZED;
}

interface ParsedLeadData {
  source?: unknown;
  leadAmount?: unknown;
  totalAmount?: unknown;
  amount?: unknown;
  bonusAmount?: unknown;
}

function parseLeadData(raw: string | undefined): ParsedLeadData {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as ParsedLeadData) : {};
  } catch {
    return {};
  }
}

/**
 * Extracts the lead amount from a Lead's `data` JSON field.
 * Tries `leadAmount`, then `totalAmount`, then `amount`.
 */
function parseLeadAmount(data: ParsedLeadData): number {
  const raw = data.leadAmount ?? data.totalAmount ?? data.amount;
  const num = typeof raw === "number" ? raw : Number(raw ?? 0);
  return Number.isFinite(num) ? num : 0;
}

function parseBonusAmount(data: ParsedLeadData): number {
  const raw = data.bonusAmount;
  const num = typeof raw === "number" ? raw : Number(raw ?? 0);
  return Number.isFinite(num) ? num : 0;
}

/**
 * Splits leads into non-referral vs referral buckets based on `data.source`.
 *
 * - **Only closed leads** (`isClosed === true`) are counted — open leads are
 *   excluded so the totals reflect realized revenue, not pipeline.
 * - Source is read from the `data` JSON column (not the legacy `source` field,
 *   which is unreliable across form versions).
 * - Amount is sourced from the `paidByLeadId` map (real money collected via
 *   `client_payments.updates[].amount`) when present; otherwise it falls back
 *   to the `data.leadAmount` / `totalAmount` / `amount` fields on the lead.
 *   Referral leads prefer `data.bonusAmount` over the lead amount.
 */
export function splitLeadsByReferral(
  leads: Lead[],
  paidByLeadId: ReadonlyMap<string, number> = new Map(),
): ReferralSplit {
  let nonReferralCount = 0;
  let nonReferralAmount = 0;
  let referralCount = 0;
  let referralAmount = 0;

  for (const lead of leads) {
    if (!lead.isClosed) continue;
    const data = parseLeadData(lead.data);
    const leadAmount = parseLeadAmount(data);
    // Prefer the real amount collected via payments; fall back to the
    // lead's own amount field when no payment record exists yet.
    const amount = paidByLeadId.get(lead.$id) ?? leadAmount;

    if (isReferralSource(data.source)) {
      referralCount += 1;
      // Referral leads: prefer explicit bonus, else fall back to the
      // resolved amount (paid if available, else planned).
      const bonus = parseBonusAmount(data);
      referralAmount += bonus > 0 ? bonus : amount;
    } else {
      nonReferralCount += 1;
      nonReferralAmount += amount;
    }
  }

  return {
    nonReferral: { count: nonReferralCount, totalAmount: nonReferralAmount },
    referral: { count: referralCount, totalAmount: referralAmount },
  };
}

// ── Legacy helper retained for backward compatibility with existing tests.
// Reads from LeadRequest (the old `lead_requests` collection) instead of the
// actual leads table. Prefer `splitLeadsByReferral` for new code.

export interface LegacyReferralSplit {
  nonReferral: { count: number; totalAmount: number };
  referral: { count: number; totalBonus: number };
}

export function splitLeadRequestsByReferral(
  requests: LeadRequest[],
): LegacyReferralSplit {
  let nonReferralCount = 0;
  let nonReferralAmount = 0;
  let referralCount = 0;
  let referralBonus = 0;

  for (const req of requests) {
    const hasReferrer = Boolean(
      req.referrerName?.trim() && req.referrerCompany?.trim(),
    );
    const hasPartialReferrer = Boolean(
      req.referrerName?.trim() || req.referrerCompany?.trim(),
    );

    if (hasReferrer) {
      referralCount += 1;
      const bonus = Number.parseFloat(req.bonusAmount ?? "0");
      referralBonus += Number.isFinite(bonus) ? bonus : 0;
    } else if (!hasPartialReferrer) {
      nonReferralCount += 1;
      nonReferralAmount += parseLeadRequestAmount(req.data);
    }
  }

  return {
    nonReferral: { count: nonReferralCount, totalAmount: nonReferralAmount },
    referral: { count: referralCount, totalBonus: referralBonus },
  };
}

function parseLeadRequestAmount(data: string): number {
  try {
    const parsed = JSON.parse(data);
    const raw = parsed.leadAmount ?? parsed.totalAmount ?? parsed.amount;
    const num = typeof raw === "number" ? raw : Number(raw ?? 0);
    return Number.isFinite(num) ? num : 0;
  } catch {
    return 0;
  }
}