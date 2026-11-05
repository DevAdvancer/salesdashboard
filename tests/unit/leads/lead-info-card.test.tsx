import { render, screen, fireEvent } from '@testing-library/react';
import { LeadInfoCard } from '@/components/leads/detail/lead-info-card';
import type { Lead, User, LeadData, FormField } from '@/lib/types';

jest.mock('@/lib/appwrite', () => ({ storage: {} }));

const fields: FormField[] = [
  { id: 'source', key: 'source', label: 'Source', type: 'text', required: false, visible: true, order: 1 },
];
function setup(data: LeadData, isEditing = false, config = fields) {
  const onFieldChange = jest.fn();
  render(<LeadInfoCard lead={{ $id: 'lead', ownerId: 'agent', data: JSON.stringify(data), isClosed: false } as Lead}
    user={{ $id: 'agent', role: 'agent' } as User} leadData={data} formFields={config}
    isEditing={isEditing} fieldErrors={{}} onFieldChange={onFieldChange} setLeadData={jest.fn()} />);
  return onFieldChange;
}

test('shows the saved referral name without a configured referral field', () => {
  setup({ source: 'Referral', referralName: 'Jane Referrer' });
  expect(screen.getByLabelText(/Referral Name/)).toHaveValue('Jane Referrer');
  expect(screen.getByLabelText(/Referral Name/)).toBeDisabled();
});

test('allows editing Referral Name through the normal field save handler', () => {
  const change = setup({ sourceName: 'Referral', referralName: 'Jane' }, true);
  fireEvent.change(screen.getByLabelText(/Referral Name/), { target: { value: 'Alex' } });
  expect(change).toHaveBeenCalledWith('referralName', 'Alex');
});

test('shows a legacy referral field once using the saved legacy value', () => {
  setup({ source: 'Referral', field_22: 'Legacy Referrer' }, false, [...fields,
    { id: 'old', key: 'field_22', label: 'Referral Name', type: 'text', required: false, visible: false, order: 2 }]);
  expect(screen.getAllByLabelText(/Referral Name/)).toHaveLength(1);
  expect(screen.getByLabelText(/Referral Name/)).toHaveValue('Legacy Referrer');
});

test('shows public referral referrer names and hides the field for other sources', () => {
  setup({ source: 'Referral Form', referrerName: 'Public Referrer' });
  expect(screen.getByLabelText(/Referral Name/)).toHaveValue('Public Referrer');
});

test('omits Referral Name for a non-referral source', () => {
  setup({ source: 'Teams Meeting' });
  expect(screen.queryByLabelText(/Referral Name/)).not.toBeInTheDocument();
});
