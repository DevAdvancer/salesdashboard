import { FormField } from "@/lib/types";

const LINKEDIN_PROFILE_FIELD_KEYS = new Set([
  "linkedinProfileUrl",
  "linkedinProfile",
  "field_16", // legacy alias — read-only, do not write back
]);

/**
 * Keys we explicitly recognize as a LinkedIn profile field on read, but
 * MUST NOT be used as the destination for new writes. New leads should
 * always save under `linkedinProfileUrl`. The legacy `field_16` key is
 * kept as a read alias so historical leads created with the generic
 * form-config still render their LinkedIn URL on the lead detail page.
 */
const LEGACY_LINKEDIN_READ_ONLY_KEYS = new Set(["field_16"]);

function normalizeFieldText(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function isLinkedinProfileField(field: Pick<FormField, "key" | "label">) {
  if (LINKEDIN_PROFILE_FIELD_KEYS.has(field.key)) return true;

  const normalizedKey = normalizeFieldText(field.key);
  const normalizedLabel = normalizeFieldText(field.label);
  const searchable = `${normalizedKey} ${normalizedLabel}`;

  return (
    searchable.includes("linkedin") &&
    (searchable.includes("profile") ||
      searchable.includes("url") ||
      searchable.includes("link"))
  );
}

export function getLinkedinProfileValue(
  data: Record<string, unknown>,
  fields: Array<Pick<FormField, "key" | "label">>,
) {
  for (const field of fields) {
    if (!isLinkedinProfileField(field)) continue;
    const value = data[field.key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }

  // Fall back to the canonical LinkedIn keys, then to the legacy alias.
  const fallback =
    data.linkedinProfileUrl ?? data.linkedinProfile ?? data.field_16;
  return typeof fallback === "string" ? fallback.trim() : "";
}

export function getLinkedinProfileDefaultValues(
  fields: Array<Pick<FormField, "key" | "label">>,
  value: string,
) {
  const trimmed = value.trim();
  if (!trimmed) return {};

  const defaults: Record<string, string> = {
    linkedinProfileUrl: trimmed,
  };

  for (const field of fields) {
    if (!isLinkedinProfileField(field)) continue;
    // Never write back to legacy aliases. New leads save only to the
    // uniform `linkedinProfileUrl` key.
    if (LEGACY_LINKEDIN_READ_ONLY_KEYS.has(field.key)) continue;
    defaults[field.key] = trimmed;
  }

  return defaults;
}
