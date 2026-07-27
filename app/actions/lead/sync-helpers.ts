import { LeadData, CreateLeadInput, Department, Lead } from "@/lib/types";
import { isReferralSource, normalizeSource } from "@/lib/utils/lead-source";
import { normalizeLinkedinProfileUrl } from "@/lib/utils/linkedin";
import { normalizeLeadStatus } from "@/lib/utils/lead-status-workflow";
import { REQUIRED_LEAD_FIELD_KEYS } from "@/lib/utils/required-lead-fields";
import { LeadActionError } from "@/lib/server/lead-errors";
import { parseISO, isValid, format, isAfter, startOfDay, addDays, getDaysInMonth, endOfMonth, endOfDay } from 'date-fns';


export function isValidId(id: string | null | undefined): boolean {
    if (!id) return false;
    const validIdPattern = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,35}$/;
    return validIdPattern.test(id);
}

export function normalizeDuplicateFieldValue(field: 'email' | 'phone' | 'linkedinProfileUrl', value: unknown) {
    if (typeof value !== 'string') return '';
    if (field === 'email') return value.trim().toLowerCase();
    if (field === 'phone') {
        const digits = value.replace(/\D/g, '');
        return digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
    }

    return normalizeLinkedinProfileUrl(value) ?? '';
}

export function isBlankLeadValue(value: unknown) {
    if (typeof value === 'string') return value.trim().length === 0;
    if (Array.isArray(value)) return value.length === 0;
    return value === null || value === undefined;
}

export function shouldIgnoreLinkedinDuplicate(doc: Record<string, unknown>, leadData: LeadData) {
    const status = typeof doc.status === 'string' ? doc.status : leadData.status;
    const normalizedStatus = normalizeLeadStatus(status);
    return normalizedStatus === 'notinterested' || normalizedStatus === 'backedout';
}

export function assertRequiredLeadData(data: LeadData) {
    const missing: Array<{ key: string; label: string }> = [];
    const isReferral = isReferralSource(data.source);
    const linkedinKeys = ['linkedinProfileUrl', 'linkedinProfile'];
    for (const key of REQUIRED_LEAD_FIELD_KEYS) {
        // Skip LinkedIn fields if source is referral
        if (isReferral && linkedinKeys.includes(key)) {
            continue;
        }

        if (Object.prototype.hasOwnProperty.call(data, key) && isBlankLeadValue(data[key])) {
            missing.push({ key, label: REQUIRED_LEAD_FIELD_LABELS[key] ?? key });
        }
    }

    if (missing.length === 0) return;
    if (missing.length === 1) {
        throw new LeadActionError(
            'MISSING_REQUIRED_FIELD',
            `${missing[0].label} is required.`,
            { field: missing[0].key },
        );
    }

    const missingLabels = missing.map((m) => m.label);
    const summary = `${missingLabels.length} required fields are missing: ${missingLabels.join(', ')}.`;
    throw new LeadActionError('MISSING_REQUIRED_FIELD', summary, {
        field: missing[0].key,
        meta: { missingFields: missing, missingLabels },
    });
}

export function parseLeadDataSafely(data: string): LeadData {
    try {
        return JSON.parse(data) as LeadData;
    } catch {
        return {};
    }
}

export function getLeadAuditName(data: LeadData): string {
    const firstName = typeof data.firstName === 'string' ? data.firstName : '';
    const lastName = typeof data.lastName === 'string' ? data.lastName : '';
    const fullName = [firstName, lastName].filter(Boolean).join(' ').trim();
    const fallback = data.legalName || data.name || data.company || data.email || data.phone;
    return fullName || (typeof fallback === 'string' ? fallback : '');
}

export function buildAuditChanges(previousData: LeadData, nextData: LeadData, changedData: Partial<LeadData>) {
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    Object.keys(changedData).forEach((key) => {
        const previousValue = previousData[key];
        const nextValue = nextData[key];
        if (JSON.stringify(previousValue) !== JSON.stringify(nextValue)) {
            changes[key] = {
                from: previousValue ?? null,
                to: nextValue ?? null,
            };
        }
    });
    return changes;
}

export function getDuplicateValue(data: LeadData, field: 'email' | 'phone' | 'linkedinProfileUrl') {
    if (field === 'linkedinProfileUrl') {
        const value = (data.linkedinProfileUrl ?? data.linkedinProfile) as unknown;
        return typeof value === 'string' ? value : undefined;
    }

    const value = data[field] as unknown;
    return typeof value === 'string' ? value : undefined;
}

export function parseIsoDateLocal(iso: string): Date {
    const [year, month, day] = iso.split("-").map(Number);
    return new Date(year, month - 1, day);
}

export function daysInMonthLocal(isoDate: string): number {
    const date = parseIsoDateLocal(isoDate);
    return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

export const REQUIRED_LEAD_FIELD_LABELS: Record<string, string> = {
        firstName: 'First Name',
        lastName: 'Last Name',
        name: 'Name',
        legalName: 'Legal Name',
        email: 'Email',
        phone: 'Phone',
        visaStatus: 'Visa Status',
        linkedinProfileUrl: 'LinkedIn profile URL',
        linkedinProfile: 'LinkedIn profile URL',
    };
