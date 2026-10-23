# Lead read volume

The Appwrite collection usage total identifies the resource, not the calling CRM
feature. These fixes address confirmed amplification paths in the code; measure
the deployed collection's next comparable business day before claiming a daily
percentage reduction.

## LinkedIn profile checks

Profile fields live inside the JSON `leads.data` column. The private
`linkedin_lead_registry` now has a derived `linkedinProfileKey` and one `lead-index`
record per LinkedIn lead. Setup writes only registry metadata; it never updates
lead data, ownership, history or `$updatedAt`.

Lookups read matching index entries, then fetch those lead IDs **plus every lead
changed since the verified checkpoint**. The latter clause covers new leads,
changed URLs, legacy fields and older deployments or native SDK writers that
do not maintain the index. Every candidate is normalized and checked live.
A failed lookup never means a profile is free.

The checkpoint advances only after validation under a distributed maintenance
lock. Its timestamp comes from Appwrite's clock before validation. The cron runs
every five minutes and reads only leads changed since the previous verified
checkpoint and their corresponding metadata. Historical coverage is validated
fully during initial setup. If refresh fails, the older checkpoint remains safe.

Profile queries allow at most 100 candidates. A 101st overflow probe or a larger
reported total blocks the operation without accepting an incomplete result. The
warm server pauses additional probes for 60 seconds. This is a per-lookup and
per-process guard, not an account-wide billing ceiling across server instances.
Production full-scan fallback is disabled by default; the explicit maintenance
override `CRM_ALLOW_FULL_PROFILE_SCAN=true` must not be enabled during normal use.
Protection reads bypass settled caches without evicting dashboard/report lists.

Run `bun run setup:lead-profile-index:dry`, review
`outputs/lead-profile-index-plan.json`, then use
`bun run setup:lead-profile-index:apply --plan=<reviewed hash>`.
`bunx tsx scripts/verify-lead-profile-index.ts` prints read-only live counts and
timing without profile URLs.

The October 23 verification used 1 lead read / 3 total database reads for an
unfamiliar profile, instead of a 1,954-row full scan. This measures lookup traffic,
not all daily application reads or the final bill.

In development, tests or an explicit maintenance override, strict fallback remains:

- CRM duplicate previews and extension profile checks share a process-local
  complete scan for at most 60 seconds. Concurrent checks also join that scan.
- The cache is bounded, scoped to the Appwrite endpoint, project, credentials,
  database and collection. Failures are not cached.
- Successful lead creates, updates and deletes invalidate the local preview.
  Changes on other server instances can take up to 60 seconds to reach a preview.
- Every new-lead save still performs a fresh authoritative check under the distributed
  profile lock. The preview cache is never used to authorize a write.
- Request creation no longer scans once before saving and again inside the
  mutation wrapper. Same-agent resends are also checked inside the lock.
- Registry hits still read the referenced lead's current status.

For a warm server receiving 100 unfamiliar-profile previews in a minute, this
changes 100 full scans into one; native registry lookups remain. This is a
bounded example, not a forecast for the whole application's daily usage.

## Contact checks during lead updates

Creation still validates email, phone and LinkedIn with the existing duplicate
rules. Updates compare the merged data with the persisted lead, after the saved
contact locks and required-field/status checks. If contact values are unchanged,
the update skips the duplicate search. A newly filled contact field is validated
without rechecking the unchanged fields; legacy LinkedIn field aliases are mapped
to the canonical field for this check. Existing saved contacts remain locked.

The legacy service also checks only changed contact values. It retains validation
for contact replacements on that older path. Permission checks, mutation history,
profile locking, ownership protection and optimistic concurrency still run.
This removes duplicate-scan reads from ordinary edits, not all reads or writes
in a save. No browser-provided "already checked" flag is trusted.

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

Payment History reads client payment updates and the follow-up source with exact
`leadId` filters, after existing history/lead authorization. Source follow-ups are
display-only: historical notes and zero-dollar entries do not alter payment
status, receipts, reporting totals or prior closure cycles. Mirrored entries are
deduplicated by `sourceFollowupId`; a later unmirrored remark edit still appears.
The individual history view bypasses settled browser/server caches, sharing only
concurrent browser loads. It does not add polling or scan other leads' payments.
This fixes existing linked records on deployment without a financial backfill.

The indexed lookup requires both verified registry metadata and the new
application deployment. Before deployment, the old application continues its
old lookup behavior. Increasing page size alone reduces HTTP calls, not returned
rows. Existing polling and preview optimizations remain in place.

To disable the index, change the checkpoint record's `leadId` from `ready`;
lookups revert to strict fallback. Do not alter lead documents. If maintenance
crashes while holding `profile-index-refresh`, inspect the process and plan
before manually clearing that private lock record.
