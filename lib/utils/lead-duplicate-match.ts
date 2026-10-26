import type { LeadData } from '@/lib/types';
import { isLeadReleased, leadProfileUrl } from '@/lib/utils/linkedin-lead-protection';

type DuplicateField = 'email' | 'phone' | 'linkedinProfileUrl';
type Candidate = Record<string, unknown>;

function contact(field: 'email' | 'phone', value: unknown) {
  if (typeof value !== 'string') return '';
  if (field === 'email') return value.trim().toLowerCase();
  const digits = value.replace(/\D/g, '');
  return digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
}

function matchingField(data: LeadData, saved: LeadData, profile: string | null, savedProfile: string | null): DuplicateField | undefined {
  if (profile && profile === savedProfile) return 'linkedinProfileUrl';
  for (const field of ['email', 'phone'] as const) {
    const value = contact(field, data[field]);
    if (value && value === contact(field, saved[field])) return field;
  }
}

/** Check every matching field before offering a released lead for reuse. */
export function findLeadDuplicate(data: LeadData, documents: Candidate[], excludeLeadId?: string) {
  const profile = leadProfileUrl(data);
  const reusable: { doc: Candidate; field: DuplicateField; canReuse: boolean }[] = [];
  for (const doc of documents) {
    if (doc.$id === excludeLeadId) continue;
    let saved: LeadData;
    try { saved = JSON.parse(String(doc.data)); } catch { continue; }
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) continue;
    const savedProfile = leadProfileUrl(saved);
    const field = matchingField(data, saved, profile, savedProfile);
    if (!field) continue;
    const released = isLeadReleased(doc.status);
    if (excludeLeadId && released && field === 'linkedinProfileUrl') continue;
    const canReuse = !excludeLeadId && released && !(profile && savedProfile && profile !== savedProfile);
    const match = { doc, field, canReuse };
    if (!canReuse) return match;
    reusable.push(match);
  }
  // Prefer the exact profile when older released records share contact details.
  return reusable.find(match => match.field === 'linkedinProfileUrl') ?? reusable[0] ?? null;
}
