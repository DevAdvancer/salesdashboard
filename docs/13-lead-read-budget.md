# Lead read volume

The Appwrite collection usage total identifies the resource, not the calling CRM
feature. These fixes address confirmed amplification paths in the code; measure
the deployed collection's next comparable business day before claiming a daily
percentage reduction.

## LinkedIn profile checks

Profile fields live inside the JSON `leads.data` column. When a profile has no
usable registry entry, protection must inspect all leads, including old records
and legacy URL fields. Increasing page size reduces HTTP requests, but does not
reduce the number of documents returned across a complete scan.

- CRM duplicate previews and extension profile checks share a process-local
  complete scan for at most 60 seconds. Concurrent checks also join that scan.
- The cache is bounded, scoped to the Appwrite endpoint, project, credentials,
  database and collection. Failures are not cached.
- Successful lead creates, updates and deletes invalidate the local preview.
  Changes on other server instances can take up to 60 seconds to reach a preview.
- Every save still performs a fresh authoritative check under the distributed
  profile lock. The preview cache is never used to authorize a write.
- Request creation no longer scans once before saving and again inside the
  mutation wrapper. Same-agent resends are also checked inside the lock.
- Registry hits still read the referenced lead's current status.

For a warm server receiving 100 unfamiliar-profile previews in a minute, this
changes 100 full scans into one; native registry lookups remain. This is a
bounded example, not a forecast for the whole application's daily usage.

## Live changes

- Lead and other empty-payload change markers are checked every 30 seconds,
  rather than every 10 seconds. Connection establishment still checks immediately.
- Identical marker reads share a 30-second bounded cache on a warm server.
  Exact visibility queries are part of the key, after fresh authorization and
  hierarchy resolution. No access decision is cached.
- Browser subscriptions with identical channels reuse one EventSource, and
  subscriptions established together create just one connection.
- Hidden tabs close their EventSource. Visible tabs reconnect and compare their
  prior versions so changes made while hidden trigger refresh.
- Chat and notification payloads retain the ten-second cadence and are not
  stored in the marker cache.

Other users' lead changes may now take around a minute to trigger a live refresh
across server instances. A manual refresh or the saving user's mutation response
does not wait for this marker check.

## Remaining cost and rollout

Authoritative checks for unregistered profiles still require complete scans.
Eliminating those requires an indexed, normalized profile column plus a verified
historical backfill; filtering raw JSON by a slug would miss valid legacy and
encoded URL variants. Do not replace the strict scan with an incomplete lookup.

This patch requires an application deployment only. It does not mutate Appwrite
schema, lead data, owners, attendance, or existing native permissions. Caches are
per warm server instance, so additional instances can each perform their own
first scan.
