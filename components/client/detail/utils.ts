"use client";

import { FormField, LeadData, PaymentStatus } from "@/lib/types";

// Ensures a "lastName" text field is always present and rendered just below
// "firstName" on the Client Detail page. Mirrors the fallback used in
// app/leads/[id]/page.tsx and DynamicLeadForm so the read-only client view
// never silently drops the last name field if the saved form config was
// edited to remove it (or created before Last Name was a default field).
export function withLastNameField(fields: FormField[]): FormField[] {
  if (fields.some((f) => f.key === "lastName")) return fields;

  const firstNameField = fields.find((f) => f.key === "firstName");
  const injected: FormField = {
    id: "static-lastname",
    key: "lastName",
    label: "Last Name",
    type: "text",
    required: false,
    visible: true,
    order: firstNameField ? firstNameField.order + 0.1 : 0,
  };

  const firstNameIndex = fields.findIndex((f) => f.key === "firstName");
  if (firstNameIndex !== -1) {
    return [
      ...fields.slice(0, firstNameIndex + 1),
      injected,
      ...fields.slice(firstNameIndex + 1),
    ];
  }
  return [injected, ...fields];
}

// Returns the lead's quoted amount as a trimmed string, or "" when the
// lead has no amount set. Used to pre-fill both the Create Payment Record
// form's upfrontAmount field and the Client Details intake's upfront
// field so the agent doesn't have to retype it on a fresh payment record.
export function getLeadAmount(leadData: LeadData): string {
  const raw = (leadData as { amount?: unknown }).amount;
  if (typeof raw === "string") return raw.trim();
  if (typeof raw === "number") return String(raw);
  return "";
}

export function renderReadOnlyValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return String(value);
  }
  if (Array.isArray(value)) return value.map((v) => String(v)).join(", ");
  return JSON.stringify(value);
}

export function formatPaymentStatusLabel(status: PaymentStatus): string {
  if (status === "fully_paid") return "Fully Paid";
  if (status === "partially_paid") return "Partially Paid";
  if (status === "non_upfront") return "Non-Upfront";
  return "Not Paid";
}
