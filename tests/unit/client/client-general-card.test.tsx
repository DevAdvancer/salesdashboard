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
