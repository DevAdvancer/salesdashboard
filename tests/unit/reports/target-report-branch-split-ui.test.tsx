import { render, screen } from '@testing-library/react';
import { TargetReportTable } from '@/components/target-report/target-report-table';

jest.mock('@/components/target-report/agent-payment-detail-dialog', () => ({ AgentPaymentDetailDialog: () => null }));

test('target report visibly keeps the NCR split next to AHM', () => {
  render(<TargetReportTable result={{ rows: [], unresolvedAgentIds: [],
    totals: { target: 10000, achieved: 6200, percent: 0.62, agentCount: 1 },
    branchSplits: [{ branchId: 'ncr', branchName: 'NCR', amount: 1200 }, { branchId: 'ahm', branchName: 'AHM', amount: 5000 }],
  }} />);
  expect(screen.getByText('NCR Split').closest('tr')).toHaveTextContent('$1,200');
  expect(screen.getByText('AHM Split').closest('tr')).toHaveTextContent('$5,000');
});
