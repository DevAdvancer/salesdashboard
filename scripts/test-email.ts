import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

import { sendNotificationEmail } from '../lib/server/email-service';

async function main() {
  const title = 'LinkedIn Auto-Withdrawal Warning';
  const body = 'This is a warning that 5 of your pending LinkedIn connection requests are approaching the expiration limit and will be auto-withdrawn tomorrow if not accepted.';

  const html = \
    <div style="font-family: sans-serif; padding: 20px;">
      <h2>\</h2>
      <p>\</p>
      <hr style="margin-top: 30px; border: none; border-top: 1px solid #eee;" />
      <p style="font-size: 12px; color: #666;">
        You are receiving this because of a new notification in the CRM.<br />
        This is sent from sales.silverspace.tech. Don't reply to this mail.
      </p>
    </div>
  \;

  console.log('Sending test email...');
  
  const info = await sendNotificationEmail({
    to: 'abhirup.kumar@vizvainc.com',
    subject: \New CRM Notification: \\,
    html: html
  });

  if (info) {
    console.log('Email sent successfully:', info.messageId);
  } else {
    console.error('Failed to send email.');
  }
}

main().catch(console.error);
