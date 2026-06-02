import { FormField } from "@/lib/types";

const LINKEDIN_PROFILE_FIELD_KEYS = new Set([
  "linkedinProfileUrl",
  "linkedinProfile",
]);

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

  const fallback = data.linkedinProfileUrl ?? data.linkedinProfile;
  return typeof fallback === "string" ? fallback.trim() : "";
}
