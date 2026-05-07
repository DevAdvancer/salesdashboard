import type { FormField, Lead, User } from '@/lib/types';

export type ReviewTargetType = 'LEAD' | 'CLIENT' | 'USER' | 'FORM_FIELD';

export interface ReviewTargetOption {
  id: string;
  type: ReviewTargetType;
  label: string;
  description: string;
  value: string;
  searchText: string;
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function parseLeadData(lead: Lead): Record<string, unknown> {
  try {
    return JSON.parse(lead.data) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function getLeadLabel(lead: Lead): string {
  const data = parseLeadData(lead);
  const firstName = normalizeText(data.firstName);
  const lastName = normalizeText(data.lastName);
  const fullName = [firstName, lastName].filter(Boolean).join(' ');

  return (
    fullName ||
    normalizeText(data.name) ||
    normalizeText(data.fullName) ||
    normalizeText(data.legalName) ||
    normalizeText(data.company) ||
    normalizeText(data.email) ||
    normalizeText(data.phone) ||
    `Record ${lead.$id}`
  );
}

function getLeadDescription(lead: Lead): string {
  const data = parseLeadData(lead);
  const details = [
    normalizeText(data.email),
    normalizeText(data.phone),
    normalizeText(data.company),
    lead.status,
  ].filter(Boolean);

  return details.length > 0 ? details.join(' / ') : lead.$id;
}

function buildOption(input: {
  id: string;
  type: ReviewTargetType;
  label: string;
  description: string;
}): ReviewTargetOption {
  const value = `${input.label} (${input.id})`;
  const searchText = [
    input.id,
    input.type,
    input.label,
    input.description,
  ].join(' ').toLowerCase();

  return {
    ...input,
    value,
    searchText,
  };
}

export function buildLeadTargetOptions(
  leads: Lead[],
  type: Extract<ReviewTargetType, 'LEAD' | 'CLIENT'>
): ReviewTargetOption[] {
  return leads.map((lead) => buildOption({
    id: lead.$id,
    type,
    label: getLeadLabel(lead),
    description: getLeadDescription(lead),
  }));
}

export function buildUserTargetOptions(users: User[]): ReviewTargetOption[] {
  return users.map((user) => buildOption({
    id: user.$id,
    type: 'USER',
    label: user.name,
    description: `${user.email} / ${user.role.replace('_', ' ')}`,
  }));
}

export function buildFormFieldTargetOptions(fields: FormField[]): ReviewTargetOption[] {
  return fields.map((field) => buildOption({
    id: field.id,
    type: 'FORM_FIELD',
    label: field.label,
    description: `${field.key} / ${field.type}${field.visible ? '' : ' / hidden'}`,
  }));
}

export function filterReviewTargetOptions(
  options: ReviewTargetOption[],
  searchQuery: string
): ReviewTargetOption[] {
  const query = searchQuery.trim().toLowerCase();
  if (!query) {
    return options;
  }

  return options.filter((option) => option.searchText.includes(query));
}

export function findReviewTargetOption(
  options: ReviewTargetOption[],
  value: string
): ReviewTargetOption | null {
  const normalizedValue = value.trim();
  if (!normalizedValue) {
    return null;
  }

  return options.find((option) => (
    option.value === normalizedValue ||
    option.id === normalizedValue ||
    option.label === normalizedValue
  )) ?? null;
}
