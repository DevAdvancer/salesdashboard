import { sendTargetAssignmentEmail } from '@/lib/server/target-assignment-email';
const mockSend = jest.fn();
const mockBounds = jest.fn();
jest.mock('@/lib/server/email-service', () => ({ sendNotificationEmail: (...args: unknown[]) => mockSend(...args) }));
jest.mock('@/lib/server/reporting-calendar', () => ({ readTargetMonthBound: () => mockBounds() }));

beforeEach(() => { jest.clearAllMocks(); mockBounds.mockResolvedValue(null); });

test('assignment mail includes the amount, month and configured final date and escapes names', async () => {
  mockBounds.mockResolvedValue({ monthKey: '2026-11', leadsFromIso: '2026-10-26', leadsToIso: '2026-12-04' });
  await sendTargetAssignmentEmail({ email: 'agent@example.com', name: '<Agent>', monthKey: '2026-11', amount: 1250, scope: 'personal' });
  expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({
    to: 'agent@example.com', subject: 'SALES-US Target Report November 2026',
    html: expect.stringContaining('Hello &lt;Agent&gt;'),
  }));
  const mail = mockSend.mock.calls[0][0];
  expect(mail.html).toContain('personal sales target for this month is $1,250.00');
  expect(mail.html).toContain('Final target report: Dec 04, 2026');
});

test('uses calendar end date when no custom bounds exist', async () => {
  await sendTargetAssignmentEmail({ email: 'tl@example.com', name: 'TL', monthKey: '2026-11', amount: 5000, scope: 'team' });
  expect(mockSend.mock.calls[0][0].html).toContain('Final target report: Nov 30, 2026');
});

test('a delivery failure does not reject an already saved target', async () => {
  const log = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  mockSend.mockRejectedValueOnce(new Error('Unavailable'));
  await expect(sendTargetAssignmentEmail({ email: 'tl@example.com', name: 'TL', monthKey: '2026-11', amount: 5000, scope: 'team' })).resolves.toBeUndefined();
  expect(log).toHaveBeenCalled();
  log.mockRestore();
});
