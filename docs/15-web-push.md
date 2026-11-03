# Web Push notifications

CRM notifications (including admin announcements) also arrive as desktop or phone
pop-ups when no CRM tab is visible, or when the CRM tab is closed while the browser runs.

## How it works

- `createNotificationRecord` ([lib/server/notifications.ts](../lib/server/notifications.ts)) queues a push
  after the response (`next/server` `after`), so requests are not slowed. Inactive recipients get none.
- [lib/server/web-push.ts](../lib/server/web-push.ts) sends to each browser in `push_subscriptions`,
  bypassing the read cache, and deletes subscriptions the push service reports as gone (404/410).
- Only real browser push services are accepted as endpoints
  ([lib/utils/web-push-endpoint.ts](../lib/utils/web-push-endpoint.ts)); the server never calls other URLs.
- The browser asks for permission once after sign-in, registers [public/sw.js](../public/sw.js) and saves its
  subscription through `savePushSubscriptionAction`, only when the user or endpoint changes (or weekly).
- Sign-out removes this browser's record and unsubscribes it, so the next person on a shared
  computer does not receive the previous user's pop-ups. Impersonation never subscribes.
- While push is active, the page no longer shows its own desktop pop-up for notifications (it still
  toasts); both use the notification ID as the tag, so one replaces the other.
- General chat messages are not pushed; they still notify in visible tabs.

## Setup (once)

1. `bun run push:keys` adds `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT`
   to `.env` (in its existing encoding) without printing the private key. Copy all three into Vercel and redeploy.
   Changing the keys later invalidates every subscription; users must allow notifications again.
2. `bun run setup:push:dry`, then `bun run setup:push:apply` creates the server-only
   `push_subscriptions` collection.

Without the keys or the collection, nothing is pushed and nothing fails.
iPhone and iPad receive pushes only when the CRM is added to the Home Screen.
