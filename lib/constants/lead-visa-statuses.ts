// Keep Sales and Lead Gen aligned without changing values stored on existing leads.
export const LEAD_VISA_STATUSES = [
  'F1', 'CPT', 'OPT', 'STEM OPT', 'F2', 'H1B', 'H4', 'H4-EAD',
  'L1', 'L2s', 'Citizen', 'Green Card', 'GC-EAD', 'TN1', 'TN2',
  'Asylum', 'Day 1 CPT',
];

export const LEAD_GEN_VISA_STATUSES = LEAD_VISA_STATUSES.map((status) =>
  status === 'Green Card' ? 'GC' : status
);

export function completeLeadVisaOptions(options: unknown): string[] {
  const key = (value: string) => {
    const normalized = value.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (normalized === 'usc' || normalized === 'uscitizen') return 'citizen';
    if (normalized === 'gc') return 'greencard';
    return normalized;
  };
  const seen = new Set<string>();
  return [...(Array.isArray(options) ? options : []), ...LEAD_VISA_STATUSES]
    .filter((option): option is string => typeof option === 'string')
    .map((option) => option.trim())
    .filter((option) => {
      const normalized = key(option);
      if (!normalized || normalized === 'other' || seen.has(normalized)) return false;
      seen.add(normalized);
      return true;
    });
}
