/** @jest-environment node */
import { POST } from '@/app/api/referrals/route';
import { NextRequest } from 'next/server';
import { createPublicLeadRequestAction } from '@/app/actions/lead-requests';
jest.mock('@/app/actions/lead-requests', () => ({ createPublicLeadRequestAction: jest.fn() }));
function request(body: unknown, origin = 'http://localhost:5000') {
  return new NextRequest('http://localhost:5000/api/referrals', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body) });
}
beforeEach(() => { jest.clearAllMocks(); });
it('rejects other origins and arbitrary CRM fields before public intake is invoked', async () => {
  expect((await POST(request({}, 'https://other.example'))).status).toBe(403);
  expect((await POST(request({ role: 'admin' }))).status).toBe(400);
  expect(createPublicLeadRequestAction).not.toHaveBeenCalled();
});
it('preserves public referral intake without exposing CRM actions or native database access', async () => {
  const fields = ['firstName', 'lastName', 'phone', 'email', 'linkedinProfileUrl', 'city', 'interestedService', 'referrerName', 'notes', 'referrerCompany', 'bonusAmount', 'paymentDate', 'paymentMode', 'salesPerson'];
  const input = Object.fromEntries(fields.map(key => [key, key]));
  (createPublicLeadRequestAction as jest.Mock).mockResolvedValue({ requestId: 'request' });
  const result = await POST(request(input));
  expect(await result.json()).toEqual({ requestId: 'request' });
  expect(createPublicLeadRequestAction).toHaveBeenCalledWith(input);
});
