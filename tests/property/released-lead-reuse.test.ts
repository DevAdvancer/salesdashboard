import fc from 'fast-check';
import { findLeadDuplicate } from '@/lib/utils/lead-duplicate-match';

const profile = 'https://linkedin.com/in/reusable-person';
const released = (status: string) => ({ $id: 'old-lead', status,
  data: JSON.stringify({ email: 'old@example.com', phone: '5551112222', field_16: profile }) });

it('offers the original lead across URL variants, contact changes, and release statuses', () => {
  fc.assert(fc.property(fc.constantFrom('Not Interested', 'Backed Out'),
    fc.constantFrom(profile, 'https://www.linkedin.com/in/reusable-person/?trk=new'),
    fc.emailAddress(), (status, url, email) => {
      expect(findLeadDuplicate({ linkedinProfileUrl: url, email, phone: '5559998888' }, [released(status)]))
        .toMatchObject({ doc: { $id: 'old-lead' }, canReuse: true, field: 'linkedinProfileUrl' });
    }));
});

it('never lets a released match hide an active collision on another field', () => {
  fc.assert(fc.property(fc.constantFrom('email', 'phone', 'linkedinProfileUrl'), fc.boolean(), (field, reverse) => {
    const data = { email: 'new@example.com', phone: '5559998888', linkedinProfileUrl: profile };
    const active = { $id: 'active', status: 'Interested', data: JSON.stringify({ [field]: data[field] }) };
    const rows = [released('Not Interested'), active];
    const result = findLeadDuplicate(data, reverse ? rows.reverse() : rows);
    expect(result).toMatchObject({ doc: { $id: 'active' }, canReuse: false });
  }));
});

it('does not transfer a different LinkedIn identity based on a shared email or phone', () => {
  fc.assert(fc.property(fc.constantFrom('email', 'phone'), field => {
    const data = { [field]: field === 'email' ? 'old@example.com' : '5551112222',
      linkedinProfileUrl: 'https://linkedin.com/in/another-person' };
    expect(findLeadDuplicate(data, [released('Not Interested')])).toMatchObject({ canReuse: false });
  }));
});
