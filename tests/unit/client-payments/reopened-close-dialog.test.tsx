import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { ComponentProps } from 'react';
import { LeadCloseDialog } from '@/components/leads/detail/lead-close-dialog';

it('shows new payment confirmation when closing a reopened lead', () => {
  const props: ComponentProps<typeof LeadCloseDialog> = {
    leadData: { paymentCycleId: 'second', firstName: 'Client' }, leadId: 'lead', userId: 'agent',
    userName: 'Agent', userRole: 'agent', userDepartment: 'sales', closeStep: 3, setCloseStep: jest.fn(),
    closeStatus: 'Won', setCloseStatus: jest.fn(), initialPaymentStatus: '', setInitialPaymentStatus: jest.fn(),
    closureFields: [], paymentPlanFields: [], closureValues: {}, setClosureValues: jest.fn(),
    paymentPlanValues: { paymentPercent: '12', paymentMonths: '4', upfrontAmount: '500' },
    setPaymentPlanValues: jest.fn(), isSaving: false, isCloseRequiredFieldsMissingFlag: false,
    missingCloseRequiredFields: [], onClose: jest.fn(), onConfirmClose: jest.fn(), renderCloseField: () => null,
  };
  render(<LeadCloseDialog {...props} />);
  expect(screen.getByText(/adds a new payment record to Payment History/)).toBeInTheDocument();
  expect(screen.getByLabelText('Initial Payment Status')).toHaveValue('partially_paid');
  expect(screen.getByRole('button', { name: 'Close Lead' })).toBeEnabled();
});
