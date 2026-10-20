# LinkedIn Helper v1.8.9 (selected-user beta)

Chrome/Edge Manifest V3 extension built with WXT, React, TypeScript, and its own Bun package. Agents click LinkedIn's Connect/Send buttons; the extension checks CRM in the background and records a confirmed invitation automatically. It never stops, delays, or replays LinkedIn clicks or keyboard input. Interrupted tracked invitations have a scoped recovery action; there is no general manual recording or connection-history control.

## Build and install

From `extensions/linkedin-helper`:

```powershell
bun install --frozen-lockfile
bun run typecheck
bun run zip
```

1. `bun run zip` creates `.output/LinkedIn Helper.zip` and automatically copies the identical beta to `releases/linkedin-helper/LinkedIn Helper.zip`, outside `public`. The authenticated `/api/extension/linkedin/download` route serves this beta only to selected eligible users and the unchanged v1.7.0 ZIP to everyone else. The CRM download button always saves it as **LinkedIn Helper.zip**; the beta manifest version is 1.8.9. The ZIP has `manifest.json` at its root, so Windows Extract All creates a **LinkedIn Helper** folder without an extra nested/versioned folder.
2. For a first installation, open `chrome://extensions` or `edge://extensions`, enable Developer mode, choose Load unpacked, and select the extracted **LinkedIn Helper** folder containing `manifest.json`. Keep that folder in a permanent location. For source builds, load `.output/chrome-mv3`.
3. For an update, replace/overwrite the files in the existing unpacked folder and click Reload on the installed extension, then reload existing LinkedIn tabs. Keep the existing loaded folder path, even if its older name differs: no folder renaming, extension removal, or Load unpacked again is needed. Avoid extracting into a numbered duplicate folder or nesting a new folder inside the loaded folder. This preserves the local account lock. Resolve interrupted invitations in CRM before updating: Chrome clears session tracking on extension reload/update, so an older missing request cannot be recovered from its cleared attempt. Existing tabs do not automatically receive a newly installed content script.
4. Sign in to CRM in the same regular browser profile and keep that tab open.
5. Open LinkedIn Helper → Connection settings → choose production or `http://localhost:5000` → Connect. Approve CRM hostname access if prompted.
6. Select the account actually signed in on LinkedIn, then **Lock account for this browser profile**. Account selection does not switch or verify LinkedIn's login.
7. Open a public LinkedIn profile. The one-line status bar shows **Available**, **Present in CRM**, **Already sent**, or **Resend available**, with the remaining allowance. It refreshes automatically when switching profiles, including LinkedIn's single-page navigation. Click the bar to see details or explicitly confirm a resend.
8. Click Connect or More → Connect → Send on LinkedIn. After a stable Pending transition on that profile, the extension records the request. The bar shows **Sent** and the remaining allowance; account details stay available by clicking it.

The popup also follows the active profile automatically. Old profile checks cannot overwrite the new profile's status. Failed on-page availability checks retry with a bounded delay; recording an invitation is never retried automatically.

## Beta distribution

An active admin selects individual users on **Beta → LinkedIn Helper beta**. Only active Sales users eligible for LinkedIn Requests can enroll. The `linkedin-helper-1.8-beta` program uses the existing `beta_feature_access` collection and starts empty; retired `linkedin-helper` grants are ignored. No user is enrolled by a code deployment. Revocation stops beta CRM reads and saves on the next API request; install the stable download to resume v1.7 use. It cannot remotely remove a previously downloaded ZIP or uninstall an unpacked extension.

The guide resolves the authenticated user's channel on mount, focus, and every minute. The download always reauthorizes independently, ignores client-supplied versions, disables caching, and uses a fixed filename. The beta bridge identifies itself with `X-CRM-Extension-Channel: beta` and is checked before reading or saving; v1.7 retains its original API contract without a beta grant. This controls CRM distribution and the packaged client's access; unpacked source is not DRM. Keep every beta ZIP outside `public/downloads`; Next's output tracing includes the private release in the download function.

Profile operations are validated against the browser's current tab URL, not the original content-script document URL, which can be stale after LinkedIn single-page navigation. Temporary navigation mismatches show **Checking…** and retry automatically. Sender identity, top-level frame, HTTPS LinkedIn origin, non-incognito tab, locked account, and original invitation-attempt bindings remain required.

This version requires the updated `/api/extension/linkedin` backend. Deploy it through the normal release process before distributing the ZIP to production users. Installing the ZIP does not deploy the backend. No Appwrite schema migration or production backfill is needed.

## Account lock and allowance

- Each Chrome/Edge browser profile has an independent local lock, bound to the CRM origin, CRM user, and assigned/delegated account. The lock persists through browser restarts. No password, JWT, API key, or LinkedIn cookie is stored.
- The dropdown stays disabled until **Unlock account** is selected. An exhausted/inactive/unassigned account is never silently replaced.
- Each opened profile checks automatically, including background tabs. Up to 100 profile checks are shared across tabs and the popup for five minutes, scoped to the CRM origin, user, locked account, canonical profile URL, and Eastern business date. Session storage retains results across worker suspension. Duplicate in-flight checks join one request. Returning to a tab reuses its saved result quietly; another profile retains its own result. Explicit Recheck bypasses completed results. Expiry, CRM navigation/session changes, account changes, rejected access, or completed/uncertain saves invalidate reuse. Invitation attempts still belong exclusively to their original tab. Final CRM recording always validates current server authorization, duplicates, leads, revision, and allowance.
- An exhausted/missing CRM limit, unavailable account, signed-out/unavailable CRM, or missing lock prevents CRM tracking/recording; LinkedIn controls remain available. The configured limit uses Eastern business dates and is separate from LinkedIn's invitation restrictions.
- The worker serializes tracking mutations. One pending invitation per locked account prevents competing CRM recording attempts in this browser profile. Additional LinkedIn sends remain usable but need review in CRM if tracking is occupied.
- The agent must deliberately unlock and select the account they are actually using to switch accounts. Keep the LinkedIn website login and CRM account lock aligned.

## Invitation detection and recovery

The content script runs on LinkedIn so it can follow single-page navigation, but sends CRM checks only for supported public `/in/` profile URLs. It identifies the viewed profile's header and its More menu, including a menu rendered outside the header. A newly opened menu is associated only with a recent click on that profile's More button. If React replaces that trigger while mounting the menu, ownership is rebound to the viewed profile's replacement More button. Clicking inside the owned menu does not discard that binding; unrelated menus still cannot confirm or start this profile's tracking. Native closed popovers do not count as visible menus. Suggested-profile invitations and unsupported surfaces remain usable but are not attributed to the viewed profile. Feed, Sales Navigator, Recruiter, and unsupported/localized layouts are outside this observer's scope.

The extension observes the user's original click and starts CRM checks independently. It never calls preventDefault/stopPropagation, disables LinkedIn controls, or synthesizes/replays a click. Connect can open a dialog and Send can finish while CRM is still responding; removing the More menu's Connect item during that process does not discard the tracking attempt. It does not initiate outreach on its own. A click, a closed dialog, an unrelated Pending button, or an unrelated toast does not count as a send. Recording requires the viewed profile to transition to Pending after the observed user click and remain there for at least 1.6 seconds without a visible failure alert. This is a website UI signal, not an official LinkedIn delivery receipt. The observed October 2026 LinkedIn layout uses plain links for Pending (href points back to the profile, without role=button); those links are included alongside buttons and menu items. Hidden controls and suggested-profile links do not confirm the viewed profile’s invitation.

Worker-session storage retains the attempt's account, actor, profile, tab, revision, and state through service-worker suspension. A cancelled invitation is not recorded. Refreshing status preserves observation of a live attempt. An interrupted armed attempt can be recovered from the original profile tab: expand the status bar, confirm you sent using the named locked account, then choose **Record confirmed invitation**. The viewed profile must show Pending continuously for at least 1.6 seconds without an invitation dialog or visible failure. Recovery checks the original user, account, profile, tab and revision with fresh allowance; a different business date or history blocks it. A save already marked saving/uncertain is never retried by this action. Resolve those cases in CRM, then explicitly clear the reviewed attempt in the popup. Account changes remain blocked until pending attempts are resolved. [Chrome clears session storage](https://developer.chrome.com/docs/extensions/reference/api/storage) on extension reload/update/disable and browser restart, so review interrupted invitations before those actions.

## Recording speed

DOM changes wake the observer after a coalesced 50 ms; the 400 ms interval remains a navigation fallback. Pending stability is observed while CRM prepares the attempt, then a timer wakes at the 1.6-second deadline instead of waiting for another poll. Visibility/style checks are limited to Pending candidates in the profile card and associated menus rather than unrelated feed controls.

For an already checked profile, the usual flow is one initial check followed by one final record request; Connect and the waiting state add no CRM checks. Verified previews are stored in extension-session storage, scoped to origin, tab, profile, CRM user/account and Eastern date, capped at 40 entries with a five-minute lifetime. They are advisory, not write authorization. A normal confirmed send makes one record request. The record endpoint freshly checks the expected CRM user, account authorization, allowance, leads, history/revision, and duplicates; the worker no longer repeats that full inspection in a separate pre-save check. Explicit recovery retains its additional review check. Read-only status requests do not occupy the mutation queue, so an old profile check cannot hold up the next profile or a save. Locks and attempt snapshots are read again before returning an independent status result. Every final record request rechecks fresh quota, lead matching, actor/assignment and duplicate history on the server, even when preparation reused the checked preview.

## CRM checks and privacy

- Lead matching scans paginated `$id`/`data` projections and compares canonical URLs across `linkedinProfileUrl`, `linkedinProfile`, and legacy `field_16`, including old case and encoding. A truncated scan fails closed. Only existence is returned; other agents' lead details never enter the extension.
- Requests retain the CRM's company-level duplicate and withdrawal/resend rules. Another company's request is not described as a profile unknown to CRM.
- New writes keep the existing request schema, stable profile/company IDs, document permissions, and the existing audit hook (persistent audit storage is disabled in this repository). Automatic saves pass an expected CRM user ID that is checked before writing.
- No history list, other-agent attribution, general manual record button, or clipboard write permission is included in the extension UI. The legacy history API remains compatible with older installations.
- The worker accepts page tracking messages only from its own extension's top-level, non-incognito HTTPS LinkedIn content script. It checks the current tab URL against the target and binds save/cancel/recovery operations to the original tab and attempt. Only the extension popup can configure or clear a lock/attempt.
- The CRM bridge performs narrowly scoped same-origin fetches in an open signed-in CRM tab. The server still authorizes current role, department, user activity, account assignment, and attendance-based delegation.

## Limits

- Observation operates while the updated extension and content script are active on supported English public profile pages. Disabling the extension, using another browser, or inviting from other LinkedIn surfaces is outside its observation scope.
- There is no distributed quota reservation across browser profiles, the CRM manual workflow, or server instances. Concurrent sends from those other clients can race; the server rechecks before saving and surfaces rejected/uncertain recordings for review.
- Lead URLs live in JSON, so accurate legacy matching requires scanning projected lead data. Large collections may make checks slower. This release adds no schema/index migration.
- Existing request queries use a string-contains filter, then canonical matching. HTTP 400 falls back to a paginated scan for older Appwrite deployments.

## Verification

From the repository root:

```powershell
bun run lint
bun run test --runInBand
bunx tsc --noEmit
bun run build
bun run dev
```

From the extension folder, run `bun run typecheck` and `bun run zip`. Jest verifies cancelled/failed dialogs, CRM-only quota rejection and nonblocking invitation clicks, competing tabs, account/user binding, duplicate saves, recovery, status colors, and automatic recording against mocked CRM responses. Do not send real LinkedIn invitations or write production CRM data as a smoke test.
