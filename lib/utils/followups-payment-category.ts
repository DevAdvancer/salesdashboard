export type FollowupsPaymentCategory = 'followup' | 'bgc' | 'other';

// Keep independent profiles in the existing manual namespace. This needs no
// Appwrite schema migration and cannot be mistaken for a real lead document.
export const BGC_FOLLOWUP_PREFIX = 'manual_followup:bgc:';

export const OTHER_FOLLOWUP_PREFIX = 'manual_followup:other:';

export function followupsPaymentCategory(leadId: unknown): FollowupsPaymentCategory {
  if (typeof leadId !== 'string') return 'followup';
  if (leadId.startsWith(BGC_FOLLOWUP_PREFIX)) return 'bgc';
  if (leadId.startsWith(OTHER_FOLLOWUP_PREFIX)) return 'other';
  return 'followup';
}
