'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Bell, Check, ExternalLink } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useAccess } from '@/lib/contexts/access-control-context';
import { useAuth } from '@/lib/contexts/auth-context';
import { listNotifications, markNotificationRead } from '@/lib/services/sop-service';
import { client, COLLECTIONS, DATABASE_ID } from '@/lib/appwrite';
import type { NotificationRecord } from '@/lib/types';
import { getLatestNotifications } from '@/lib/utils/notifications';
import { useToast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils';

const NOTIFICATION_FALLBACK_POLL_MS = 5 * 60 * 1000;
const NOTIFICATION_FORCE_REFRESH_COOLDOWN_MS = 5000;

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

export function NotificationBell({ className }: { className?: string }) {
  const router = useRouter();
  const { user } = useAuth();
  const { canAccess, isLoading: accessLoading } = useAccess();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const toastedIdsRef = useRef<Set<string>>(new Set());
  const lastForceRefreshAt = useRef(0);

  const canSeeNotifications = Boolean(user) && !accessLoading && canAccess('notifications');
  const unreadCount = useMemo(
    () => notifications.filter((notification) => !notification.readAt).length,
    [notifications]
  );
  const visibleNotifications = useMemo(
    () => getLatestNotifications(notifications, 5),
    [notifications]
  );

  const load = useCallback(async ({ forceRefresh = false }: { forceRefresh?: boolean } = {}) => {
    if (!user || !canSeeNotifications) return;
    try {
      setLoading(true);
      const next = await listNotifications(user.$id, { forceRefresh });
      setNotifications(next);

      const unassigned = next.filter(
        (notification) =>
          !notification.readAt &&
          notification.type === 'lead_unassigned' &&
          !toastedIdsRef.current.has(notification.$id)
      );

      unassigned.forEach((notification) => {
        toastedIdsRef.current.add(notification.$id);
        toast({
          title: notification.title || 'Unassigned lead generated',
          description: notification.body,
        });
      });
    } catch (error) {
      console.error('Failed to load notification bell:', error);
      setNotifications([]);
    } finally {
      setLoading(false);
    }
  }, [canSeeNotifications, toast, user]);

  const forceLoad = useCallback(() => {
    const now = Date.now();
    if (now - lastForceRefreshAt.current < NOTIFICATION_FORCE_REFRESH_COOLDOWN_MS) {
      return;
    }

    lastForceRefreshAt.current = now;
    void load({ forceRefresh: true });
  }, [load]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!canSeeNotifications) return;

    const intervalId = window.setInterval(() => {
      void load({ forceRefresh: true });
    }, NOTIFICATION_FALLBACK_POLL_MS);
    window.addEventListener('focus', forceLoad);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('focus', forceLoad);
    };
  }, [canSeeNotifications, forceLoad, load]);

  useEffect(() => {
    if (!user || !canSeeNotifications) return;

    const unsubscribe = client.subscribe(
      `databases.${DATABASE_ID}.collections.${COLLECTIONS.NOTIFICATIONS}.documents`,
      () => {
        forceLoad();
      }
    );

    return () => {
      unsubscribe();
    };
  }, [canSeeNotifications, load, user]);

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
    <div className={cn('relative z-50 w-10', className)}>
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
          <span className="absolute -right-1 -top-1 flex min-w-5 items-center justify-center rounded-full bg-foreground px-1.5 text-[0.6875rem] font-semibold text-background">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute left-0 top-12 w-[min(22rem,calc(100vw-2rem))] border border-border bg-background shadow-none">
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
