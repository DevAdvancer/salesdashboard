import { getClientPaymentRecord } from '@/lib/services/client-payment-service';
import { getClientPaymentRecordAction } from '@/app/actions/client-payments/record';
import { clearClientReadCache } from '@/lib/utils/client-read-cache';

jest.mock('@/app/actions/client-payments/record', () => ({ getClientPaymentRecordAction: jest.fn() }));
jest.mock('@/app/actions/client-payments/insights', () => ({}));
jest.mock('@/app/actions/client-payments/list', () => ({}));
jest.mock('@/lib/services/dashboard-data-service', () => ({ clearDashboardDataCache: jest.fn() }));

it('shares concurrent history loads but fetches later openings fresh', async () => {
  clearClientReadCache();
  const read = getClientPaymentRecordAction as jest.Mock;
  read.mockResolvedValueOnce({ followupUpdates: [] })
    .mockResolvedValueOnce({ followupUpdates: [{ id: 'new', note: 'New follow-up' }] });
  const [first, concurrent] = await Promise.all([getClientPaymentRecord('actor', 'lead'), getClientPaymentRecord('actor', 'lead')]);
  expect(first).toBe(concurrent);
  expect(read).toHaveBeenCalledTimes(1);
  const fresh = await getClientPaymentRecord('actor', 'lead');
  expect(fresh?.followupUpdates).toEqual([{ id: 'new', note: 'New follow-up' }]);
  expect(read).toHaveBeenCalledTimes(2);
});
