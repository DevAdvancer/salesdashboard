import type { LeadData, LeadValidationResult } from '@/lib/types';

/** Both form previews and writes use the authenticated server duplicate policy. */
export async function validateLeadUniqueness(
  data: LeadData, excludeLeadId?: string,
): Promise<LeadValidationResult> {
  return (await import('@/app/actions/lead/validation')).validateLeadUniquenessAction(data, excludeLeadId);
}
