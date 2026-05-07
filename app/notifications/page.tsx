'use client';

import { useCallback, useEffect, useState } from 'react';
import { Bell } from 'lucide-react';
import { ProtectedRoute } from '@/components/protected-route';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/lib/contexts/auth-context';
import { listNotifications, markNotificationRead } from '@/lib/services/sop-service';
import type { NotificationRecord } from '@/lib/types';

export default function NotificationsPage() {
  return (
    <ProtectedRoute componentKey="notifications">
      <NotificationsContent />
    </ProtectedRoute>
  );
}

function NotificationsContent() {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState<NotificationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadNotifications = useCallback(async () => {
    if (!user) return;
    try {
      setLoading(true);
      setError(null);
      setNotifications(await listNotifications(user.$id));
    } catch (error) {
      console.error('Failed to load notifications:', error);
      setNotifications([]);
      setError('Notifications are not available for your current permissions.');
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void loadNotifications();
  }, [loadNotifications]);

  const read = async (notificationId: string) => {
    if (!user) return;
    try {
      await markNotificationRead(user.$id, notificationId);
      await loadNotifications();
    } catch (error) {
      console.error('Failed to mark notification read:', error);
      setError('You are not authorized to update this notification.');
    }
  };

  return (
    <div className="container mx-auto space-y-6">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold">Notifications</h1>
        <p className="text-muted-foreground">Assignments, reviews, follow-ups, and system alerts.</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bell className="h-4 w-4" />
            Inbox
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading ? (
            <NotificationListSkeleton />
          ) : error ? (
            <p className="rounded-md border border-destructive p-3 text-sm text-muted-foreground">
              {error}
            </p>
          ) : notifications.length === 0 ? (
            <p className="text-sm text-muted-foreground">No notifications yet.</p>
          ) : notifications.map((notification) => (
            <div key={notification.$id} className="rounded-md border border-border p-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-sm font-medium">{notification.title}</p>
                  <p className="text-sm text-muted-foreground">{notification.body}</p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {notification.type} / {new Date(notification.createdAt).toLocaleString()}
                  </p>
                </div>
                {!notification.readAt && (
                  <Button size="sm" variant="outline" onClick={() => read(notification.$id)}>
                    Mark read
                  </Button>
                )}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function NotificationListSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 4 }).map((_, index) => (
        <div key={index} className="rounded-md border border-border p-3">
          <Skeleton className="h-4 w-48" />
          <Skeleton className="mt-2 h-3 w-full" />
          <Skeleton className="mt-2 h-3 w-40" />
        </div>
      ))}
    </div>
  );
}
