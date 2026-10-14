import type { LeadData } from "@/lib/types";

export type LockedLeadContactField = "email" | "phone" | "linkedinProfileUrl";

export function isLockedLeadContactField(key: string): key is LockedLeadContactField {
  return key === "email" || key === "phone" || key === "linkedinProfileUrl";
}

export function getLeadContactValue(data: LeadData, field: LockedLeadContactField): string {
  const value = field === "linkedinProfileUrl"
    ? [data.linkedinProfileUrl, data.linkedinProfile, data.field_16,
        ...Object.entries(data)
          .filter(([key]) => isLinkedinUrlKey(key))
          .map(([, candidate]) => candidate),
      ].find(
        (candidate) => typeof candidate === "string" && candidate.trim(),
      )
    : data[field];
  return typeof value === "string" ? value.trim() : "";
}

function isLinkedinUrlKey(key: string): boolean {
  if (key === "field_16") return true;
  const suffix = key.toLowerCase().replace("linkedin", "");
  return key !== suffix && /(url|profile|link)/.test(suffix);
}

export function isLeadContactLocked(data: LeadData, field: LockedLeadContactField): boolean {
  return Boolean(getLeadContactValue(data, field));
}

export function getChangedLockedLeadContactField(
  saved: LeadData,
  next: LeadData,
): LockedLeadContactField | null {
  for (const field of ["email", "phone", "linkedinProfileUrl"] as const) {
    const previous = getLeadContactValue(saved, field);
    if (previous && previous !== getLeadContactValue(next, field)) return field;
  }
  if (getLeadContactValue(saved, "linkedinProfileUrl")) {
    for (const [key, value] of Object.entries(saved)) {
      if (!isLinkedinUrlKey(key)) continue;
      if (typeof value === "string" && value.trim() && value !== next[key]) {
        return "linkedinProfileUrl";
      }
    }
  }
  return null;
}

export function mergeLockedClientContactDetails(
  leadData: LeadData,
  savedClientDetails: Record<string, unknown>,
  submittedDetails: Record<string, unknown>,
): Record<string, unknown> {
  const merged = { ...submittedDetails };
  for (const field of ["email", "phone", "linkedinProfileUrl"] as const) {
    const saved = getLeadContactValue(savedClientDetails as LeadData, field) ||
      getLeadContactValue(leadData, field);
    if (!saved) continue;
    const submitted = getLeadContactValue(submittedDetails as LeadData, field);
    if (submitted && submitted !== saved) {
      const labels = { email: "Email", phone: "Phone number", linkedinProfileUrl: "LinkedIn URL" };
      throw new Error(`${labels[field]} cannot be changed after it is saved.`);
    }
    merged[field] = saved;
  }
  return merged;
}
