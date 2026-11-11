import { useQuery } from '@tanstack/react-query';
import { useLeadsQuery } from '@/lib/queries/leads/use-leads-query';

jest.mock('@tanstack/react-query', () => ({ useQuery: jest.fn(), keepPreviousData: jest.fn() }));
jest.mock('@/lib/queries/leads/use-lead-change-refresh', () => ({ wantsFreshLeadRead: () => false }));

const args = { userId: 'agent', role: 'agent' as const, page: 1, pageSize: 10 };

it('refreshes Client History whenever opened, and on focus once its data is 30 seconds old', () => {
  useLeadsQuery({ ...args, filters: { isClosed: true, sortBy: 'closedAt' } });
  expect(useQuery).toHaveBeenLastCalledWith(expect.objectContaining({
    staleTime: 30_000, refetchOnMount: 'always', refetchOnWindowFocus: true,
  }));
});

it('keeps the normal lead list cache settings', () => {
  useLeadsQuery({ ...args, filters: {} });
  const options = (useQuery as jest.Mock).mock.calls.at(-1)[0];
  expect(options).not.toHaveProperty('staleTime');
  expect(options).not.toHaveProperty('refetchOnMount');
});
