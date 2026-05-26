'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bell, Check, ExternalLink } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useAccess } from '@/lib/contexts/access-control-context';
import { useAuth } from '@/lib/contexts/auth-context';
import { listNotifications, markNotificationRead } from '@/lib/services/sop-service';
import type { NotificationRecord } from '@/lib/types';
import { getLatestNotifications } from '@/lib/utils/notifications';

function formatNotificationTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return date.toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
  });
}

export function NotificationBell() {
  const router = useRouter();
  const { user } = useAuth();
  const { canAccess, isLoading: accessLoading } = useAccess();
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationRecord[]>([]);
  const [loading, setLoading] = useState(false);

  const canSeeNotifications = Boolean(user) && !accessLoading && canAccess('notifications');
  const unreadCount = useMemo(
    () => notifications.filter((notification) => !notification.readAt).length,
    [notifications]
  );
  const visibleNotifications = useMemo(
    () => getLatestNotifications(notifications, 5),
    [notifications]
  );

  const load = useCallback(async () => {
    if (!user || !canSeeNotifications) return;
    try {
      setLoading(true);
      setNotifications(await listNotifications(user.$id));
    } catch (error) {
      console.error('Failed to load notification bell:', error);
      setNotifications([]);
    } finally {
      setLoading(false);
    }
  }, [canSeeNotifications, user]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!canSeeNotifications) return;

    const intervalId = window.setInterval(() => {
      void load();
    }, 30000);

    return () => window.clearInterval(intervalId);
  }, [canSeeNotifications, load]);

  if (!canSeeNotifications) {
    return null;
  }

  const markRead = async (notificationId: string) => {
    if (!user) return;
    try {
      await markNotificationRead(user.$id, notificationId);
      await load();
    } catch (error) {
      console.error('Failed to mark notification read:', error);
    }
  };

  return (
    <div className="fixed right-4 top-3 z-50 w-10 sm:right-6 lg:right-8">
      <button
        type="button"
        aria-label="Notifications"
        aria-expanded={open}
        title="Notifications"
        onClick={() => {
          setOpen((value) => !value);
          void load();
        }}
        className="relative flex size-10 items-center justify-center rounded-full border border-border bg-[var(--soft-cloud)] text-foreground shadow-none transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ink)]"
      >
        <Bell className="h-4 w-4" />
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 flex min-w-5 items-center justify-center rounded-full bg-[var(--ink)] px-1.5 text-[0.6875rem] font-semibold text-white">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-12 w-[min(22rem,calc(100vw-2rem))] border border-border bg-background shadow-none">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <div>
              <p className="text-sm font-semibold">Notifications</p>
              <p className="text-xs text-muted-foreground">{unreadCount} unread</p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setOpen(false);
                router.push('/notifications');
              }}
            >
              <ExternalLink className="mr-2 h-3.5 w-3.5" />
              Open
            </Button>
          </div>

          <div className="max-h-[22rem] overflow-y-auto p-2">
            {loading ? (
              <div className="space-y-2 p-2">
                <Skeleton className="h-14 w-full" />
                <Skeleton className="h-14 w-full" />
                <Skeleton className="h-14 w-full" />
              </div>
            ) : visibleNotifications.length === 0 ? (
              <p className="p-3 text-sm text-muted-foreground">No notifications yet.</p>
            ) : (
              visibleNotifications.map((notification) => (
                <div key={notification.$id} className="px-3 py-2 hover:bg-muted/50">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{notification.title}</p>
                      <p className="line-clamp-2 text-xs text-muted-foreground">{notification.body}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {notification.type} / {formatNotificationTime(notification.createdAt)}
                      </p>
                    </div>
                    {!notification.readAt && (
                      <button
                        type="button"
                        aria-label="Mark notification read"
                        title="Mark read"
                        onClick={() => markRead(notification.$id)}
                        className="flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
                      >
                        <Check className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
