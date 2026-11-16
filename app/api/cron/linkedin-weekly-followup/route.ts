import { format, parseISO, subDays } from 'date-fns';
import { NextResponse } from 'next/server';
import { COLLECTIONS } from '@/lib/constants/appwrite';
import { createAdminClient } from '@/lib/server/appwrite';
import { sendLinkedinWeeklyFollowups } from '@/lib/server/linkedin-weekly-followup';
import { getCurrentEasternIsoDate } from '@/lib/utils/eastern-date';
import { logger } from '@/lib/utils/logger';

const fridayHour = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', weekday: 'long', hour: '2-digit', hourCycle: 'h23',
});

export const maxDuration = 300;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const now = new Date();
  const parts = fridayHour.formatToParts(now);
  if (parts.find(part => part.type === 'weekday')?.value !== 'Friday' ||
      parts.find(part => part.type === 'hour')?.value !== '09') {
    return NextResponse.json({ ok: true, skipped: true });
  }

  const end = getCurrentEasternIsoDate(now);
  const start = format(subDays(parseISO(end), 4), 'yyyy-MM-dd');
  try {
    const { databases } = await createAdminClient({ systemActor: { id: 'system', name: 'LinkedIn weekly follow-up' } });
    databases.clearReadCacheForCollection(COLLECTIONS.USERS);
    databases.clearReadCacheForCollection(COLLECTIONS.LINKEDIN_REQUESTS);
    databases.clearReadCacheForCollection(COLLECTIONS.LINKEDIN_CONVERSATIONS);
    const result = await sendLinkedinWeeklyFollowups(databases, { start, end });
    const ok = result.failed === 0;
    return NextResponse.json({ ok, ...result }, { status: ok ? 200 : 500 });
  } catch (error) {
    logger.error('LinkedIn weekly follow-up report failed', error);
    return NextResponse.json({ ok: false, error: 'Weekly follow-up report could not complete.' }, { status: 500 });
  }
}
