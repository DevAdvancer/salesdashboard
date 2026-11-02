import { sendNotificationEmail } from '@/lib/server/email-service';
import { readTargetMonthBound } from '@/lib/server/reporting-calendar';
import { calendarMonthWindow } from '@/lib/utils/reporting-period';
import { targetReportEmailDates, targetReportEmailSubject } from '@/lib/utils/target-report-email';

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
}

// Email delivery must not make a successfully saved target appear to have failed.
export async function sendTargetAssignmentEmail(input: {
  email: string; name: string; monthKey: string; amount: number; scope: 'team' | 'personal';
}) {
  if (!input.email) return;
  try {
    const period = await readTargetMonthBound(input.monthKey) ?? calendarMonthWindow(input.monthKey);
    const amount = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(input.amount);
    const message = `Your ${input.scope} sales target for this month is ${amount}.`;
    const dates = targetReportEmailDates(period);
    await sendNotificationEmail({
      to: input.email,
      subject: targetReportEmailSubject(input.monthKey),
      html: `<p>Hello ${escapeHtml(input.name)},</p><p>${message}</p><p>${dates}</p><p>This is an automated CRM notification. Please do not reply.</p>`,
      text: `Hello ${input.name},\n\n${message}\n\n${dates}`,
    });
  } catch {
    console.error('[monthly-targets] Target saved, but its assignment email could not be sent.');
  }
}
