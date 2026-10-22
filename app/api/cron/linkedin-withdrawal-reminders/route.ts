import { NextResponse, type NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/server/appwrite';
import { runLinkedinWithdrawalSweep, sendLinkedinWithdrawalReport } from '@/lib/server/linkedin-auto-withdraw';
import { getRequestCount, withRequestMeter } from '@/lib/server/appwrite-request-meter';
import { easternWallTimeToIso, getCurrentEasternIsoDate } from '@/lib/utils/eastern-date';
import { logger } from '@/lib/utils/logger';

function isAuthorized(request: NextRequest) {
  const expected = process.env.CRON_SECRET;
  const bearer = request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  const provided = bearer ?? request.headers.get('x-cron-secret');
  return Boolean(expected && provided && provided === expected);
}

// Retain the existing scheduled URL for deployed cron integrations.
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const { result } = await withRequestMeter(runAutomaticWithdrawal);
    return result;
  } catch (error) {
    logger.error('LinkedIn automatic withdrawal failed', error);
    return NextResponse.json({ ok: false, error: 'LinkedIn automatic withdrawal could not complete.' }, { status: 500 });
  }
}

async function runAutomaticWithdrawal() {
  const now = new Date();
  const { databases } = await createAdminClient({ systemActor: { id: 'system', name: 'Scheduled LinkedIn withdrawal' } });
  const withdrawal = await runLinkedinWithdrawalSweep(databases, now);
  const report = await sendLinkedinWithdrawalReport(databases, withdrawal.withdrawn, now, {
    sendEmpty: true,
    failedCount: withdrawal.errors.length,
  }).catch(error => {
    logger.error('LinkedIn withdrawal report could not be emailed', error);
    return { emailSent: false, recipientCount: 0 };
  });
  const ok = withdrawal.errors.length === 0 && report.emailSent;

  // Monday runs automatically, including holidays. Only the Settings report is
  // mailed; no due reminders or agent completion notifications are generated.
  return NextResponse.json({
    ok,
    todayStartIso: easternWallTimeToIso(`${getCurrentEasternIsoDate(now)}T00:00`),
    evaluated: withdrawal.evaluated,
    planned: withdrawal.planned.length,
    remindersSent: 0,
    remindersSkipped: true,
    autoWithdrawn: withdrawal.withdrawn.length,
    withdrawalErrors: withdrawal.errors.length,
    reportEmailSent: report.emailSent,
    reportRecipientCount: report.recipientCount,
    ...(!report.emailSent ? { reportError: report.recipientCount > 0
      ? 'Withdrawal report delivery failed.' : 'Could not deliver the report. Check Settings recipients and email configuration.' } : {}),
    appwriteRequests: getRequestCount(),
  }, { status: ok ? 200 : 500 });
}
