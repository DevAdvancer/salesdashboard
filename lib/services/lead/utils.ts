import { LeadData } from '@/lib/types';

export function isValidId(id: string | null | undefined): boolean {
    if (!id) return false;
    const validIdPattern = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,35}$/;
    return validIdPattern.test(id);
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

export function normalizeStatusText(value: unknown) {
  const text = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return text.replace(/[^a-z0-9]/g, '');
}

export function isLinkedinRequestLeadData(data: LeadData) {
  const requestId = (data as any).linkedinRequestId;
  if (typeof requestId === 'string' && requestId.trim().length > 0) return true;
  const source = typeof (data as any).source === 'string' ? (data as any).source.trim() : '';
  const sourceName =
    typeof (data as any).sourceName === 'string' ? (data as any).sourceName.trim() : '';
  const normalizedSource = normalizeStatusText(source || sourceName);
  return normalizedSource === 'linkedinlead' || normalizedSource === 'linkedin';
}
