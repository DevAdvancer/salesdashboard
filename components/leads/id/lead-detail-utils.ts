import { FormField, LeadData } from "@/lib/types";
import { normalizeLeadStatus } from "@/lib/utils/lead-status-workflow";

export function isBackoutStatus(value: unknown) {
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

export function normalizeStatusText(value: unknown) {
  return normalizeLeadStatus(value);
}

export function formatFollowUpDateTime(value?: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatFollowUpStatus(value?: string | null): string {
  if (!value) return "Not set";
  const normalized = value.toLowerCase();
  if (normalized === "pending") return "Pending";
  if (normalized === "completed") return "Completed";
  if (normalized === "overdue") return "Overdue";
  return value;
}

export function isNotInterestedStatus(value: unknown) {
  return normalizeStatusText(value) === "notinterested";
}

export function isLinkedinRequestLead(data: LeadData) {
  const requestId = (data as any).linkedinRequestId;
  return typeof requestId === "string" && requestId.trim().length > 0;
}

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

export function withLegalNameField(fields: FormField[]): FormField[] {
  if (fields.some((f) => f.key === "legalName")) return fields;

  const firstNameField = fields.find((f) => f.key === "firstName");
  const injected: FormField = {
    id: "static-legalname",
    key: "legalName",
    label: "Legal Name",
    type: "text",
    required: true,
    visible: true,
    order: firstNameField ? firstNameField.order + 0.5 : 1.5,
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

export function withAmountField(fields: FormField[]): FormField[] {
  if (fields.some((f) => f.key === "amount" || f.key === "field_15")) {
    return fields;
  }
  const firstNameField = fields.find((f) => f.key === "firstName");
  const injected: FormField = {
    id: "static-amount",
    key: "amount",
    label: "Amount ($)",
    type: "text",
    required: true,
    visible: true,
    order: firstNameField ? firstNameField.order + 1.5 : 12.5,
  };
  const firstNameIndex = fields.findIndex((f) => f.key === "firstName");
  if (firstNameIndex !== -1) {
    return [
      ...fields.slice(0, firstNameIndex + 1),
      injected,
      ...fields.slice(firstNameIndex + 1),
    ];
  }
  return [...fields, injected];
}
