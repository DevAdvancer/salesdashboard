import { assertRequiredLeadData } from '@/app/actions/lead/sync-helpers';
import { generateSourceAwareZodSchema } from '@/lib/utils/form-schema-generator';
import { shouldShowRequiredAsterisk } from '@/lib/utils/required-lead-fields';
import type { FormField } from '@/lib/types';

const phone: FormField = { id: 'phone', key: 'phone', label: 'Phone', type: 'phone', required: false, visible: true, order: 1 };

describe('phone requirement by lead source', () => {
  test.each(['Website', 'Referral', 'Cold Calls', 'LinkedIN/Lead', 'Other', '', undefined])('requires phone for source %s in both UI and server validation', source => {
    const schema = generateSourceAwareZodSchema([phone], source);
    expect(schema.safeParse({ phone: '', referralName: 'Referrer' }).success).toBe(false);
    expect(shouldShowRequiredAsterisk('phone', false, source)).toBe(true);
    for (const value of [undefined, null, '', '   ']) {
      expect(() => assertRequiredLeadData({ source, phone: value as any })).toThrow('Phone is required');
    }
    expect(() => assertRequiredLeadData({ source, phone: '5551234567' })).not.toThrow();
  });

  test.each(['Teams Meeting', ' teams meeting ', 'TEAMS MEETING'])('allows omitted phone for %s even if config marks it required', source => {
    expect(generateSourceAwareZodSchema([{ ...phone, required: true }], source).safeParse({ phone: '' }).success).toBe(true);
    expect(shouldShowRequiredAsterisk('phone', true, source)).toBe(false);
    expect(() => assertRequiredLeadData({ source })).not.toThrow();
    expect(() => assertRequiredLeadData({ sourceName: source, phone: '' })).not.toThrow();
  });
});
