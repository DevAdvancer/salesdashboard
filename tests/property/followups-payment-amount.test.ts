import fc from 'fast-check';
import { getFollowupsPaymentAmount, getStoredFollowupsPaymentAmount } from '@/lib/utils/followups-payment-amount';

it('stores either input sign as a nonnegative magnitude and preserves refund deductions', () => {
  fc.assert(fc.property(fc.integer({ min: 1, max: Number.MAX_SAFE_INTEGER }), amount => {
    expect(getStoredFollowupsPaymentAmount(amount)).toBe(amount);
    expect(getStoredFollowupsPaymentAmount(-amount)).toBe(amount);
    expect(getFollowupsPaymentAmount({ amount, status: 'refunded' })).toBe(-amount);
    expect(getFollowupsPaymentAmount({ amount: -amount })).toBe(-amount);
    expect(getFollowupsPaymentAmount({ amount, status: 'paid' })).toBe(amount);
  }));
});

it.each([NaN, Infinity, -Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1])('rejects invalid storage amounts %s', amount => {
  expect(() => getStoredFollowupsPaymentAmount(amount)).toThrow('Payment amount');
});
