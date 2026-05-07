import { getLatestNotifications } from '@/lib/utils/notifications';
import type { NotificationRecord } from '@/lib/types';

function notification(id: string, createdAt: string): NotificationRecord {
  return {
    $id: id,
    recipientId: 'user_1',
    type: 'test',
    title: id,
    body: id,
    createdAt,
    readAt: null,
  };
}

describe('getLatestNotifications', () => {
  it('returns only the newest five notifications', () => {
    const result = getLatestNotifications([
      notification('old', '2026-05-01T12:00:00.000Z'),
      notification('newest', '2026-05-07T12:00:00.000Z'),
      notification('second', '2026-05-06T12:00:00.000Z'),
      notification('third', '2026-05-05T12:00:00.000Z'),
      notification('fourth', '2026-05-04T12:00:00.000Z'),
      notification('fifth', '2026-05-03T12:00:00.000Z'),
      notification('sixth', '2026-05-02T12:00:00.000Z'),
    ]);

    expect(result.map((item) => item.$id)).toEqual([
      'newest',
      'second',
      'third',
      'fourth',
      'fifth',
    ]);
  });
});
