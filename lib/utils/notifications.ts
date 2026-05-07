import type { NotificationRecord } from '@/lib/types';

export function getLatestNotifications(
  notifications: NotificationRecord[],
  limit = 5
): NotificationRecord[] {
  return [...notifications]
    .sort((a, b) => {
      const bTime = new Date(b.createdAt).getTime();
      const aTime = new Date(a.createdAt).getTime();
      return (Number.isNaN(bTime) ? 0 : bTime) - (Number.isNaN(aTime) ? 0 : aTime);
    })
    .slice(0, limit);
}
