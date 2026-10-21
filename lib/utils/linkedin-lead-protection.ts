import { normalizeStoredProfileUrl } from '@/lib/utils/linkedin-extension-url';
import { canonicalizeLeadStatus } from '@/lib/utils/lead-status-workflow';

export function leadProfileUrl(data: unknown): string | null {
  let fields: Record<string, unknown>;
  try { fields = typeof data === 'string' ? JSON.parse(data) : data as Record<string, unknown>; }
  catch { return null; }
  for (const key of ['linkedinProfileUrl', 'linkedinProfile', 'field_16']) {
    try { if (fields?.[key]) return normalizeStoredProfileUrl(String(fields[key])); } catch { /* Try the legacy alias. */ }
  }
  return null;
}

export function isLeadReleased(status: unknown) {
  return ['Not Interested', 'Backed Out'].includes(canonicalizeLeadStatus(status));
}

export function leadOwnershipMayChange(before: Record<string, unknown>, patch: Record<string, unknown>, unassignedOwnerId?: string) {
  const ownerChanged = 'ownerId' in patch && patch.ownerId !== before.ownerId;
  if (!ownerChanged) return true; // Normal team assignment remains an existing CRM operation.
  if (isLeadReleased(before.status)) return true;
  // The existing close operation moves released leads to the configured holding user.
  return Boolean(unassignedOwnerId && patch.ownerId === unassignedOwnerId && isLeadReleased(patch.status));
}
