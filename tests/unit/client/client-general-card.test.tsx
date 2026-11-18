import { render, screen } from '@testing-library/react';
import { ClientGeneralCard } from '@/components/client/detail/client-general-card';
import type { FormField } from '@/lib/types';

const field: FormField = { id: 'field_16', key: 'field_16', label: 'LinkedIn Profile URL',
  type: 'text', visible: true, required: false, order: 1 };

describe('Client History LinkedIn profile display', () => {
  it.each(['linkedinProfileUrl', 'linkedinProfile', 'field_16'])(
    'shows the saved %s value under the legacy configured field', key => {
      render(<ClientGeneralCard formFields={[field]} leadData={{ [key]: 'https://linkedin.com/in/client' }} />);
      expect(screen.getByLabelText('LinkedIn Profile URL')).toHaveValue('https://linkedin.com/in/client');
    });

  it('reads a legacy URL when the form configuration uses the canonical key', () => {
    render(<ClientGeneralCard formFields={[{ ...field, key: 'linkedinProfileUrl' }]}
      leadData={{ linkedinProfileUrl: '', field_16: 'https://linkedin.com/in/legacy' }} />);
    expect(screen.getByLabelText('LinkedIn Profile URL')).toHaveValue('https://linkedin.com/in/legacy');
  });
});

describe('Client History referral name display', () => {
  const referralField: FormField = { id: 'field_22', key: 'field_22', label: 'Referral name',
    type: 'text', visible: true, required: false, order: 2 };

  it('shows the canonical saved name once when the configured field uses a different key', () => {
    render(<ClientGeneralCard formFields={[referralField]}
      leadData={{ source: 'Referral', referralName: 'Jane Referrer' }} />);
    expect(screen.getAllByLabelText(/referral name/i)).toHaveLength(1);
    expect(screen.getByLabelText(/referral name/i)).toHaveValue('Jane Referrer');
  });

  it('uses a configured legacy value when the canonical value is blank', () => {
    render(<ClientGeneralCard formFields={[referralField]}
      leadData={{ source: 'Referral', referralName: '', field_22: 'Legacy Referrer' }} />);
    expect(screen.getByLabelText(/referral name/i)).toHaveValue('Legacy Referrer');
  });

  it.each(['referralName', 'referral', 'referrerName', 'Referral Name'])(
    'displays the saved %s without a configured field or referral source', key => {
      render(<ClientGeneralCard formFields={[]}
        leadData={{ [key]: 'Saved Referrer' }} />);
      expect(screen.getByLabelText(/referral name/i)).toHaveValue('Saved Referrer');
    });
});
