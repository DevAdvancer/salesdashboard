import type { Lead, LeadRequest } from "@/lib/types";
import { isClientExcludedStatus } from "@/lib/utils/client-history";

export interface ReferralSplitBucket {
  count: number;
  totalAmount: number;
  fullyPaidAmount: number;
  partiallyPaidAmount: number;
}

export interface ReferralSplit {
  nonReferral: ReferralSplitBucket;
  referral: ReferralSplitBucket;
}

export interface ReferralPaymentRecord {
  leadId: string;
  source: string;
  leadStatus: string;
  isClosed: boolean;
  closedAt: string | null;
  upfrontAmount: number;
  createdAt: string;
  totalPaid: number | null;
  status?: string | null;
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

function isDateOnlyString(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function toComparableIsoDate(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (isDateOnlyString(trimmed)) return trimmed;

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function resolvePaidAmount(record: ReferralPaymentRecord): number {
  if (typeof record.totalPaid === "number" && Number.isFinite(record.totalPaid)) {
    return Math.max(0, record.totalPaid);
  }

  if (record.status === "fully_paid") {
    return Number.isFinite(record.upfrontAmount)
      ? Math.max(0, record.upfrontAmount)
      : 0;
  }

  return 0;
}

export function splitPaymentInsightsByReferral(
  records: ReferralPaymentRecord[],
  startDate: string,
  endDate: string,
): ReferralSplit {
  const normalizedStart = toComparableIsoDate(startDate);
  const normalizedEnd = toComparableIsoDate(endDate);
  if (!normalizedStart || !normalizedEnd) {
    return {
      nonReferral: {
        count: 0,
        totalAmount: 0,
        fullyPaidAmount: 0,
        partiallyPaidAmount: 0,
      },
      referral: {
        count: 0,
        totalAmount: 0,
        fullyPaidAmount: 0,
        partiallyPaidAmount: 0,
      },
    };
  }

  let nonReferralCount = 0;
  let nonReferralAmount = 0;
  let nonReferralFullyPaidAmount = 0;
  let nonReferralPartiallyPaidAmount = 0;
  let referralCount = 0;
  let referralAmount = 0;
  let referralFullyPaidAmount = 0;
  let referralPartiallyPaidAmount = 0;

  for (const record of records) {
    // Payment records are the source of truth for this widget. Prefer the
    // lead's closedAt when present; otherwise fall back to the payment record
    // creation date so client counts do not drop when lead metadata is stale
    // or missing.
    const eventDate = toComparableIsoDate(record.closedAt ?? record.createdAt);
    if (!eventDate || eventDate < normalizedStart || eventDate > normalizedEnd) {
      continue;
    }

    const paidAmount = resolvePaidAmount(record);

    if (isReferralSource(record.source)) {
      referralCount += 1;
      referralAmount += paidAmount;
      if (record.status === "fully_paid") {
        referralFullyPaidAmount += paidAmount;
      } else {
        referralPartiallyPaidAmount += paidAmount;
      }
    } else {
      nonReferralCount += 1;
      nonReferralAmount += paidAmount;
      if (record.status === "fully_paid") {
        nonReferralFullyPaidAmount += paidAmount;
      } else {
        nonReferralPartiallyPaidAmount += paidAmount;
      }
    }
  }

  return {
    nonReferral: {
      count: nonReferralCount,
      totalAmount: nonReferralAmount,
      fullyPaidAmount: nonReferralFullyPaidAmount,
      partiallyPaidAmount: nonReferralPartiallyPaidAmount,
    },
    referral: {
      count: referralCount,
      totalAmount: referralAmount,
      fullyPaidAmount: referralFullyPaidAmount,
      partiallyPaidAmount: referralPartiallyPaidAmount,
    },
  };
}

interface ParsedLeadData {
  source?: unknown;
  leadAmount?: unknown;
  totalAmount?: unknown;
  amount?: unknown;
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

export function filterClosedLeadsInDateRange(
  leads: Lead[],
  startDate: string,
  endDate: string,
): Lead[] {
  const normalizedStart = toComparableIsoDate(startDate);
  const normalizedEnd = toComparableIsoDate(endDate);
  if (!normalizedStart || !normalizedEnd) return [];

  return leads.filter((lead) => {
    if (!lead.isClosed) return false;
    const closedDate = toComparableIsoDate(lead.closedAt);
    return Boolean(
      closedDate &&
      closedDate >= normalizedStart &&
      closedDate <= normalizedEnd,
    );
  });
}

/**
 * Splits leads into non-referral vs referral buckets based on `data.source`.
 *
 * - **Only closed leads** (`isClosed === true`) are counted — open leads are
 *   excluded so the totals reflect realized revenue, not pipeline.
 * - Source is read from the `data` JSON column (not the legacy `source` field,
 *   which is unreliable across form versions).
 * - Amount is sourced from the payment plan's upfront amount when present.
 *   If that is unavailable, it falls back to the actual paid total from
 *   `client_payments.updates[].amount`, then finally to the lead form amount.
 *   Referral and non-referral leads intentionally use the same money source so
 *   the split stays consistent with the payment setup.
 */
export function splitLeadsByReferral(
  leads: Lead[],
  paidByLeadId: ReadonlyMap<string, number> = new Map(),
  upfrontByLeadId: ReadonlyMap<string, number> = new Map(),
  statusByLeadId: ReadonlyMap<string, string> = new Map(),
): ReferralSplit {
  let nonReferralCount = 0;
  let nonReferralAmount = 0;
  let nonReferralFullyPaidAmount = 0;
  let nonReferralPartiallyPaidAmount = 0;
  let referralCount = 0;
  let referralAmount = 0;
  let referralFullyPaidAmount = 0;
  let referralPartiallyPaidAmount = 0;

  for (const lead of leads) {
    if (!lead.isClosed) continue;
    if (isClientExcludedStatus(lead.status)) continue;
    const data = parseLeadData(lead.data);
    const leadAmount = parseLeadAmount(data);
    // Prefer the payment plan's upfront amount for the referral split. If that
    // is missing, fall back to the paid total, then finally to lead data.
    const amount =
      upfrontByLeadId.get(lead.$id) ??
      paidByLeadId.get(lead.$id) ??
      leadAmount;
    const status = statusByLeadId.get(lead.$id) ?? null;

    if (isReferralSource(data.source)) {
      referralCount += 1;
      referralAmount += amount;
      if (status === "fully_paid") {
        referralFullyPaidAmount += amount;
      } else {
        referralPartiallyPaidAmount += amount;
      }
    } else {
      nonReferralCount += 1;
      nonReferralAmount += amount;
      if (status === "fully_paid") {
        nonReferralFullyPaidAmount += amount;
      } else {
        nonReferralPartiallyPaidAmount += amount;
      }
    }
  }

  return {
    nonReferral: {
      count: nonReferralCount,
      totalAmount: nonReferralAmount,
      fullyPaidAmount: nonReferralFullyPaidAmount,
      partiallyPaidAmount: nonReferralPartiallyPaidAmount,
    },
    referral: {
      count: referralCount,
      totalAmount: referralAmount,
      fullyPaidAmount: referralFullyPaidAmount,
      partiallyPaidAmount: referralPartiallyPaidAmount,
    },
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
