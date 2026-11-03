import { render, screen } from '@testing-library/react';
import { PaymentsSection } from '@/components/dashboard/payments-section';
import { selectCrmOption } from '@/tests/helpers/custom-controls';
import type { PaymentInsightRecord } from '@/app/actions/client-payments/shared';

const records = [
  { company: 'Vizva INC', branchId: 'ncr', upfrontAmount: 1000, followupsTotal: 200, totalPaid: 1200, pendingTotal: 99999, leadAmount: 3000 },
  { company: 'Silverspace INC', branchId: 'ahm', upfrontAmount: 300, followupsTotal: 50, totalPaid: 350, pendingTotal: 99999, leadAmount: 1000 },
  { company: 'Vizva INC', branchId: null, upfrontAmount: 0, followupsTotal: 80, leadAmount: 0, isFollowupOnly: true },
].map((record, index) => ({ leadId: String(index), leadStatus: 'Won', status: 'fully_paid', createdAt: '2026-11-01', upfrontReceived: record.upfrontAmount, ...record })) as PaymentInsightRecord[];
test('NCR and AHM splits use the same receipts and company filter as the revenue total', async () => {
  render(<PaymentsSection records={records} isLoading={false} branches={[{ $id: 'ncr', name: 'NCR', isActive: true }, { $id: 'ahm', name: 'AHM', isActive: true }]}
    technicalPayments={[{ branchId: 'ncr', amount: 20, company: 'Vizva INC' }, { branchId: 'ahm', amount: 30, company: 'Silverspace INC' }]} />);
  expect(screen.getByText('NCR Split:').closest('tr')).toHaveTextContent('$1,220');
  expect(screen.getByText('AHM Split:').closest('tr')).toHaveTextContent('$380');
  expect(screen.getByText('Unassigned branch:').closest('tr')).toHaveTextContent('$80');
  await selectCrmOption(screen.getByLabelText('Filter by company'), 'Vizva INC');
  expect(screen.getByText('NCR Split:').closest('tr')).toHaveTextContent('$1,220');
  expect(screen.getByText('AHM Split:').closest('tr')).toHaveTextContent('$0');
});

test('the reported NCR case is $1200 for Silverspace, not $6200 including Vizva', async () => {
  const rows = [
    { company: 'Silverspace INC', upfrontAmount: 6200, upfrontReceived: 1200 },
    { company: 'Vizva INC', upfrontAmount: 5000, upfrontReceived: 5000 },
  ].map((row, index) => ({ leadId: String(index), branchId: 'ncr', leadStatus: 'Won', status: 'fully_paid', leadAmount: 10000, followupsTotal: 0, ...row })) as PaymentInsightRecord[];
  render(<PaymentsSection records={rows} isLoading={false} branches={[{ $id: 'ncr', name: 'NCR', isActive: true }]} />);
  expect(screen.getByText('NCR Split:').closest('tr')).toHaveTextContent('$6,200');
  await selectCrmOption(screen.getByLabelText('Filter by company'), 'Silverspace INC');
  expect(screen.getByText('NCR Split:').closest('tr')).toHaveTextContent('$1,200');
  expect(screen.getByText('NCR Split:').closest('tr')).not.toHaveTextContent('$6,200');
});

test('all companies keep the explicitly selected 1200 in NCR and legacy 5000 in AHM', () => {
  const rows = [
    { company: 'Silverspace INC', branchId: 'ncr', upfrontReceived: 1200 },
    { company: 'Vizva INC', branchId: 'ahm', upfrontReceived: 5000 },
  ].map((row, index) => ({ leadId: String(index), upfrontAmount: row.upfrontReceived, leadAmount: row.upfrontReceived, leadStatus: 'Won', status: 'fully_paid', followupsTotal: 0, ...row })) as PaymentInsightRecord[];
  render(<PaymentsSection records={rows} isLoading={false} branches={[{ $id: 'ncr', name: 'NCR', isActive: true }, { $id: 'ahm', name: 'AHM', isActive: true }]} />);
  expect(screen.getByText('NCR Split:').closest('tr')).toHaveTextContent('$1,200');
  expect(screen.getByText('AHM Split:').closest('tr')).toHaveTextContent('$5,000');
});
