import type { Lead, LeadData } from '@/lib/types';
import { normalizeLinkedinProfileUrl } from '@/lib/utils/linkedin';
import { createAdminClient } from '@/lib/appwrite';
import { DATABASES, COLLECTIONS } from '@/lib/constants/appwrite';
import { ID } from 'appwrite';

export type PublicLeadRequestInput = {
  firstName?: unknown;
  lastName?: unknown;
  name?: unknown;
  email?: unknown;
  phone?: unknown;
  linkedinProfileUrl?: unknown;
  city?: unknown;
  interestedService?: unknown;
  referrerName?: unknown;
  notes?: unknown;
  referrerCompany?: unknown;
  bonusAmount?: unknown;
  paymentDate?: unknown;
  paymentMode?: unknown;
  salesPerson?: unknown;
};

export type NormalizedPublicLeadRequestInput = {
  firstName: string;
  lastName: string;
  name: string;
  email: string;
  phone: string;
  linkedinProfileUrl: string;
  city: string;
  interestedService: string;
  referrerName: string;
  notes: string;
  referrerCompany: string;
  bonusAmount: string;
  paymentDate: string;
  paymentMode: string;
  salesPerson: string;
};

export type LeadRequestDuplicateWarning = {
  field: 'email' | 'phone' | 'linkedinProfileUrl';
  existingLeadId: string;
  existingBranchId?: string;
  existingLeadOwnerName?: string;
  existingLeadAssignedToName?: string;
};

export function normalizePublicLeadRequestInput(
  input: PublicLeadRequestInput,
): NormalizedPublicLeadRequestInput {
  const firstName = cleanText(input.firstName || input.name);
  const lastName = cleanText(input.lastName);
  return {
    firstName,
    lastName,
    name: [firstName, lastName].filter(Boolean).join(' ') || cleanText(input.name),
    email: cleanText(input.email).toLowerCase(),
    phone: cleanText(input.phone),
    linkedinProfileUrl: normalizeLinkedinProfileUrl(cleanText(input.linkedinProfileUrl)) ?? '',
    city: cleanText(input.city),
    interestedService: cleanText(input.interestedService),
    referrerName: cleanText(input.referrerName),
    notes: cleanText(input.notes),
    referrerCompany: cleanText(input.referrerCompany),
    bonusAmount: cleanText(input.bonusAmount),
    paymentDate: cleanText(input.paymentDate),
    paymentMode: cleanText(input.paymentMode),
    salesPerson: cleanText(input.salesPerson),
  };
}

export function buildLeadRequestLeadData(
  input: NormalizedPublicLeadRequestInput,
  leadRequestId: string,
): LeadData {
  const data: LeadData = {
    firstName: input.firstName || input.name,
    lastName: input.lastName,
    phone: input.phone,
    source: 'Referral Form',
    sourceName: 'Referral Form',
    leadRequestId,
  };

  for (const [key, value] of Object.entries({
    email: input.email,
    linkedinProfileUrl: input.linkedinProfileUrl,
    city: input.city,
    interestedService: input.interestedService,
    referrerName: input.referrerName,
    notes: input.notes,
    referrerCompany: input.referrerCompany,
    bonusAmount: input.bonusAmount,
    paymentDate: input.paymentDate,
    paymentMode: input.paymentMode,
    salesPerson: input.salesPerson,
  })) {
    if (value) data[key] = value;
  }

  return data;
}

export async function findLeadRequestDuplicateWarnings(
  input: Pick<NormalizedPublicLeadRequestInput, 'email' | 'phone' | 'linkedinProfileUrl'>,
  leads: Lead[],
): Promise<LeadRequestDuplicateWarning[]> {
  const { databases } = await createAdminClient();

  const inputEmail = normalizeDuplicateFieldValue('email', input.email);
  const inputPhone = normalizeDuplicateFieldValue('phone', input.phone);
  const inputLinkedin = normalizeDuplicateFieldValue('linkedinProfileUrl', input.linkedinProfileUrl);
  const warnings: LeadRequestDuplicateWarning[] = [];

  for (const lead of leads) {
    const leadData = parseLeadData(lead.data);
    if (!leadData) continue;

    if (
      inputEmail &&
      warnings.every((warning) => warning.field !== 'email') &&
      normalizeDuplicateFieldValue('email', leadData.email) === inputEmail
    ) {
      warnings.push({
        field: 'email',
        existingLeadId: lead.$id,
        existingBranchId: lead.branchId ?? undefined,
        existingLeadOwnerName: await getUserDocumentName(databases, lead.ownerId),
        existingLeadAssignedToName: await getUserDocumentName(databases, lead.assignedToId),
      });
    }

    if (
      inputPhone &&
      warnings.every((warning) => warning.field !== 'phone') &&
      normalizeDuplicateFieldValue('phone', leadData.phone) === inputPhone
    ) {
      warnings.push({
        field: 'phone',
        existingLeadId: lead.$id,
        existingBranchId: lead.branchId ?? undefined,
        existingLeadOwnerName: await getUserDocumentName(databases, lead.ownerId),
        existingLeadAssignedToName: await getUserDocumentName(databases, lead.assignedToId),
      });
    }

    if (
      inputLinkedin &&
      warnings.every((warning) => warning.field !== 'linkedinProfileUrl') &&
      normalizeDuplicateFieldValue(
        'linkedinProfileUrl',
        leadData.linkedinProfileUrl ?? leadData.linkedinProfile,
      ) === inputLinkedin
    ) {
      warnings.push({
        field: 'linkedinProfileUrl',
        existingLeadId: lead.$id,
        existingBranchId: lead.branchId ?? undefined,
        existingLeadOwnerName: await getUserDocumentName(databases, lead.ownerId),
        existingLeadAssignedToName: await getUserDocumentName(databases, lead.assignedToId),
      });
    }

    if (warnings.length === 3) break;
  }

  return warnings;
}

export function formatLeadRequestDuplicateMessage(warnings: LeadRequestDuplicateWarning[]) {
  if (warnings.length === 0) return '';
  return warnings
    .map((warning) => {
      const label =
        warning.field === 'linkedinProfileUrl' ? 'LinkedIn profile URL' : warning.field;
      const agentNames = [];
      if (warning.existingLeadOwnerName) {
        agentNames.push(`owned by ${warning.existingLeadOwnerName}`);
      }
      if (warning.existingLeadAssignedToName) {
        agentNames.push(`assigned to ${warning.existingLeadAssignedToName}`);
      }
      const agentSuffix = agentNames.length > 0
        ? ` (currently ${agentNames.join(' and ')})`
        : '';
      const branch = warning.existingBranchId ? ` in branch ${warning.existingBranchId}` : '';
      return `${label} already exists on lead ${warning.existingLeadId}${branch}${agentSuffix}`;
    })
    .join('; ');
}

function cleanText(value: unknown) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
}

function parseLeadData(data: string): LeadData | null {
  try {
    const parsed = JSON.parse(data) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as LeadData)
      : null;
  } catch {
    return null;
  }
}

export function normalizeDuplicateFieldValue(
  field: 'email' | 'phone' | 'linkedinProfileUrl',
  value: unknown,
) {
  if (typeof value !== 'string') return '';
  if (field === 'email') return value.trim().toLowerCase();
  if (field === 'phone') {
    const digits = value.replace(/\D/g, '');
    return digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  }
  return normalizeLinkedinProfileUrl(value) ?? '';
}

async function getUserDocumentName(databases: any, userId?: string): Promise<string | undefined> {
  if (!userId) return undefined;
  try {
    const userDoc = await databases.getDocument(DATABASE_ID, COLLECTIONS.USERS, userId);
    return (userDoc as any).name;
  } catch {
    return undefined;
  }
}