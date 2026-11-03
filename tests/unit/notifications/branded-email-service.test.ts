const mockSend = jest.fn(async () => ({ messageId: 'test-message' }));
jest.mock('nodemailer', () => ({ __esModule: true, default: { createTransport: () => ({ sendMail: (...args: unknown[]) => mockSend(...args) }) } }));
jest.mock('dotenv', () => ({ __esModule: true, default: { config: jest.fn() } }));
jest.mock('@/lib/server/appwrite', () => ({ createAdminClient: async () => ({ databases: {} }) }));
jest.mock('@/lib/server/active-email-recipients', () => ({ excludeInactiveUserEmails: async (_db: unknown, emails: string[]) => emails }));

test('notification transport receives the branded HTML and preserves recipients, subject, text and attachments', async () => {
  const saved = { ...process.env };
  process.env.GMAIL_USER = 'crm@example.test';
  process.env.GMAIL_APP_PASSWORD = 'test-only';
  try {
    const { sendNotificationEmail } = await import('@/lib/server/email-service');
    const attachments = [{ filename: 'report.csv', content: 'NCR,1200', contentType: 'text/csv' }];
    await sendNotificationEmail({ to: 'agent@example.test', subject: 'Target Report', html: '<p>NCR $1,200</p>', text: 'NCR $1,200', attachments });
    expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({ to: 'agent@example.test', subject: 'Target Report', text: 'NCR $1,200', attachments,
      html: expect.stringContaining('SALES INTELLIGENCE') }));
    expect(mockSend.mock.calls[0][0].html).toContain('NCR $1,200');
  } finally { process.env = saved; }
});
