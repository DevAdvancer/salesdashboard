import { Lead } from '@/lib/types';

export function getLeadDisplayName(lead: Lead): string {
    try {
        const data = JSON.parse(lead.data) as Record<string, unknown>;
        const firstName = String(data.firstName ?? '').trim();
        const lastName = String(data.lastName ?? '').trim();
        const company = String(data.company ?? '').trim();
        const email = String(data.email ?? '').trim();
        return [firstName, lastName].filter(Boolean).join(' ') || company || email || 'Lead';
    } catch {
        return 'Lead';
    }
}

export function getUnassignedOwnerId(): string {
    return (
        process.env.NEXT_PUBLIC_APPWRITE_UNASSIGNED_OWNER_ID ||
        process.env.APPWRITE_UNASSIGNED_OWNER_ID ||
        ''
    );
}

export function getLeadResumeFileId(lead: Lead): string | null {
    try {
        const data = JSON.parse(lead.data) as { resumeFileId?: unknown };
        return typeof data.resumeFileId === 'string' && data.resumeFileId ? data.resumeFileId : null;
    } catch {
        return null;
    }
}

export function getLeadLinkedinRequestId(lead: Lead): string | null {
    try {
        const data = JSON.parse(lead.data) as { linkedinRequestId?: unknown };
        return typeof data.linkedinRequestId === 'string' && data.linkedinRequestId ? data.linkedinRequestId : null;
    } catch {
        return null;
    }
}

export function resolveBranchIdForEvent(lead: Lead): string | null {
  const raw = (lead as unknown as { data?: string }).data;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw) as { branchIds?: unknown; branchId?: unknown };
      if (Array.isArray(parsed.branchIds) && typeof parsed.branchIds[0] === "string") {
        return parsed.branchIds[0] as string;
      }
      if (typeof parsed.branchId === "string") {
        return parsed.branchId;
      }
    } catch {
      // fall through to top-level fields
    }
  }
  return lead.branchId ?? null;
}
