# CRM HUB LinkedIn Helper

Chrome/Edge Manifest V3 extension built with **WXT + React + TypeScript**. This replaces the earlier plain JavaScript implementation. Its source, dependencies, Bun lockfile, generated types, and browser bundles are isolated in this folder.

## Build and install

From this folder:

```powershell
bun install --frozen-lockfile
bun run typecheck
bun run build
bun run zip
```

1. Open `chrome://extensions` (Chrome) or `edge://extensions` (Edge).
2. Enable **Developer mode** and click **Load unpacked**.
3. Select **`extensions/linkedin-helper/.output/chrome-mv3`**, which contains the generated `manifest.json`. Do not select this source folder.
4. Pin **CRM HUB LinkedIn Helper** to the toolbar.
5. Sign in to CRM in the same regular browser profile and keep that tab open.
6. Open a public LinkedIn profile, click the extension, open **Connection settings** using the header icon, choose `crm.silverspaceinc.tech` or `localhost:5000`, and click **Connect**. The production URL is the default for a fresh installation; your last connected environment is remembered. Approve access to your CRM hostname if prompted.
7. Choose the LinkedIn account you are actually using. Optionally **Check before inviting**; after manually sending the invitation on LinkedIn, click **Record request sent**. Use **View history** only when needed.

The ready-to-extract ZIP is generated at `.output/crm-hub-linkedin-helper-1.4.0-chrome.zip`. Extract it into a folder and load that folder as unpacked. The ZIP contains only the compiled extension, not source, dependencies, or credentials. It is not a signed Web Store package.

The updated CRM must provide `/api/extension/linkedin`. Use the local CRM (`bun run dev` from the repository root, http://localhost:5000) until the additive endpoint is deployed through your normal release process. Installing the extension does not install this endpoint on an already deployed CRM. Nothing here commits, pushes, deploys, or migrates Appwrite data.

If the old extension is installed, remove it from your browser before loading the WXT build. Its unpacked path changes, so Chrome may assign a new extension ID; reconnect and choose your account again.

## Development

`bun run dev` starts WXT development mode with React updates. For installation and smoke testing, use the production build in `.output/chrome-mv3`; the development bundle includes WXT development permissions and tooling. After rebuilding, click **Reload** on the browser's extensions page and reopen the popup. Restarting the browser alone can leave its previous background worker script cached.

Source layout:

```text
entrypoints/background.ts      typed service worker and CRM session bridge
entrypoints/popup/App.tsx      React popup
entrypoints/popup/RequestDetails.tsx  account, allowance, and history views
entrypoints/popup/main.tsx     React mount
entrypoints/popup/style.css    popup styles
lib/crm-client.ts              typed messaging, storage, and tab helpers
lib/crm-read-coordinator.ts    worker-owned checks and short-lived session results
lib/use-linkedin-helper.ts     React workflow, request guards, and state
lib/use-page-theme.ts          active LinkedIn presentation theme detection
wxt.config.ts                 manifest, React module, shared-code alias
```

The browser-independent contract and URL rules are shared with the backend through `crm-shared`, an alias for the repository's `lib` folder. The CRM does not import extension source. The root TypeScript config excludes the extension project; root lint excludes its generated files and nested dependencies. The root CRM dependencies and lockfiles remain unchanged. This nested package uses `bun.lock` and has no npm lockfile to maintain.

## Behavior

- Dropdown lists active assigned accounts and today's attendance-based delegated accounts. Selection is remembered per CRM origin and authenticated CRM user. Unavailable remembered accounts are not silently replaced.
- Opening the popup detects the active public `/in/` profile without checking history. Manual URL entry remains available. Tracking parameters and trailing slashes are removed. The popup follows the CRM's neutral palette and bundles its Silverspace and Vizva logos.
- The compact popup is 360 pixels wide and at most 560 pixels tall, with a slim scrollbar in its content area. Header and footer remain visible. Connection settings are hidden behind the header icon. The header logos crossfade every 4.5 seconds using the sidebar's timing; reduced-motion preferences disable the animation. The extension toolbar icon and popup favicon use the CRM's Silverspace favicon.
- The popup follows the active LinkedIn page's light or dark background, checking presentation every two seconds while open. This uses the existing `activeTab`/`scripting` permissions and reads only computed background colors. When page access is unavailable, it retains the last detected theme for the browser session or falls back to system preference. It never changes the LinkedIn page's theme.
- Recording is available immediately after accounts load. One server inspection checks duplicates, existing leads, assignment and allowance before a new write. Existing requests return a status without silently resending; full history is loaded only with **View history**. **Check before inviting** remains an optional read-only availability check.
- Closing the popup does not cancel a dispatched check. Reopening on the same account/profile joins that check; completed account and history responses are reused for up to 30 seconds. Browser-session storage retains completed responses through worker suspension, and the last entered profile is restored for the same CRM user if there is no active LinkedIn profile.
- **Refresh**, **Check before inviting**, and **View history** bypass completed cached responses. Saves always reach CRM, clear cached reads, and are never automatically retried. Auth rejections, detected CRM tab navigation/closure, and a changed CRM user invalidate cached responses.
- Checking is read-only. Results include existing-lead blocking, active-request blocking, resend eligibility and allowance; history is returned only for the separate history operation.
- Eligible old requests need an explicit resend checkbox. Resending uses the existing CRM action and preserves its stored legacy URL. Active requests are not silently reassigned.
- History is for the selected company's requests; other agents' personal details are hidden. Existing timestamps do not reconstruct every overwritten resend.
- Allowance uses the CRM's Eastern business date and configured limit. It is not LinkedIn's actual invitation quota. Account selection does not switch the LinkedIn website's login.
- No invitations are automatically sent, accepted, or withdrawn.

## Authentication and permissions

The worker injects a narrowly defined same-origin fetch into the open CRM tab's isolated extension world. Cookies stay in the browser. No password, API key, or copied JWT is stored. The backend identifies the actor from the CRM session and checks current role, department, active status, assignment, and delegation.

Production permissions are `activeTab`, `storage`, and `scripting`. Local development hosts are declared upfront; the selected production HTTPS hostname is requested on Connect. HTTPS hosts in the manifest are optional, not blanket granted access. Chrome grants permissions per hostname across ports; tab selection and fetching still pin the exact configured origin. There is no LinkedIn content script or page scraping.

Incognito tabs are unsupported. You can close the popup while working; keep the signed-in CRM tab open. Session caches contain recent display data, not credentials, and are cleared by a browser restart or extension reload. If the CRM session expires, open CRM, sign in, and reconnect or refresh the extension. Writes are never automatically retried after an uncertain response: check the profile before retrying.

## Backend and limitations

The additive `/api/extension/linkedin` endpoint uses the existing Appwrite collections, document shape, and permissions. GET loads accounts and usage; POST checks, loads history, or records a request. It requires same-origin browser metadata plus a bridge header, returns `Cache-Control: no-store`, and rejects client-supplied actor IDs. Direct new recording needs no earlier revision; explicit resends require a current checked revision and confirmation. Recording inspects once and returns its completed write and updated allowance without a second inspection.

Stable company/profile document IDs prevent concurrent new creates from this extension from creating a second extension record. A revision binds the actor, account, URL, Eastern date, and current history; changes require another check.

The existing CRM pages, services, server actions, and access rules remain unchanged. Its usual refresh may be needed to show newly recorded rows. No schema migration or production backfill is needed.

Known inherited limits:

- Daily allowance is rechecked before saving, but without distributed transactions simultaneous writes for different profiles can exceed it. Writes from the unchanged CRM and extension can race on duplicate/resend operations. Resolving this across both clients requires changing the existing mutation path and database support.
- Profile matching uses Appwrite's string `contains` filter on the profile path, then exact URL normalization to retain legacy tracking-link protection. Older deployments rejecting that query with HTTP 400 fall back to the original company scan. No database migration is applied. Large result sets or deployments using the fallback may still take longer.
- Lead duplication reuses the CRM validator's existing one-year/1,000-record search window.
- Only public `linkedin.com/in/...` and `www.linkedin.com/in/...` URLs are supported. Sales Navigator, Recruiter, localized hosts, and company pages are unsupported.

## Verification

From the repository root:

```powershell
bun run lint
bun run test --runInBand
bunx tsc --noEmit
bun run build
```

From this folder, run `bun run typecheck` and `bun run zip`. Jest remains the repository's test runner. Extension browser save scenarios are verified using mocked CRM responses so they never write to production Appwrite.
