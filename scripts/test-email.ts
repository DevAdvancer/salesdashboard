import { sendNotificationEmail } from './lib/server/email-service';

async function main() {
    console.log("Sending email to alisha...");
    const res = await sendNotificationEmail({
        to: 'alisha.dsouza@silverspaceinc.com',
        subject: 'New CRM Notification: Lead assigned (Test)',
        text: 'This is a test notification.',
        html: '<p>This is a test notification.</p>'
    });
    console.log("Result:", res);
}
main().catch(console.error);
