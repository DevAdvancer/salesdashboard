export type FollowupsPaymentCategory = 'followup' | 'bgc';

// Keep independent profiles in the existing manual namespace. This needs no
// Appwrite schema migration and cannot be mistaken for a real lead document.
export const BGC_FOLLOWUP_PREFIX = 'manual_followup:bgc:';

export function followupsPaymentCategory(leadId: unknown): FollowupsPaymentCategory {
  return typeof leadId === 'string' && leadId.startsWith(BGC_FOLLOWUP_PREFIX) ? 'bgc' : 'followup';
}
