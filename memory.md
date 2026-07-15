# memory.md

Compressed knowledge base for this project. Source of truth alongside the code.

## Project Summary

Next.js 16 App Router CRM ("SalesHub" / "ResumeHub") on Appwrite. Two independent
auth systems: Appwrite (CRM sessions) and Azure/MSAL (Microsoft Graph/Outlook).
Two departments — `sales` and `resume` — each with its own dashboard, chat, and
navigation. Dev server runs on port 5000. Package manager: bun.

## Architecture (essentials)

- **Provider chain**: AzureMsalProvider → ErrorBoundary → AuthProvider →
  AccessControlProvider → AppLayout → Toaster (`app/layout.tsx`).
- **Leads**: business fields in a JSON `data` string; stable columns are
  `ownerId`, `assignedToId`, `branchId`, `status`. Always `JSON.parse(lead.data)`.
- **Users**: Appwrite auth mirrored in `users` collection; doc ID = account ID.
  `department` (`'sales'`|`'resume'`, default `'sales'`). `branchIds` current,
  `branchId` deprecated.
- **Server patterns**: client SDK (`lib/services/*`), server actions
  (`app/actions/*`, node-appwrite admin), API routes (`app/api/**`).
- **Access control** = two layers: UI (`access-control-context.tsx` +
  `ProtectedRoute`) and Appwrite doc permissions. Three `ComponentKey` unions must
  stay in sync: `lib/types/index.ts`, `lib/contexts/access-control-context.tsx`,
  and (imported) `lib/constants/component-access.ts`. `lib/constants/default-access.ts`
  has its own stale partial union — recent department routes intentionally skip it
  and rely on the `COMPONENT_ACCESS` default fallback.

## Roles

admin, developer (=admin), team_lead, agent, lead_generation, monitor (read-only
admin visibility), operations (broad read/op access). Leadership =
admin/developer/monitor/operations — can cross dashboards.

## Feature: Call Requests (Sales → Resume) — COMPLETED

Sales raises a call request against one of their clients after confirming a
document checklist; the Resume team works/assigns it, walks its status, and both
sides chat per-request.

- **Collection**: `call_requests` (`COLLECTIONS.CALL_REQUESTS`, env
  `NEXT_PUBLIC_APPWRITE_CALL_REQUESTS_COLLECTION_ID`, default `call_requests`).
  Attributes: leadId, clientName, status(enum: not_called|pending_documents|
  call_done, default not_called), requestedById/Name, assignedToId/Name,
  documentsChecklist (JSON string), chat (JSON string, size 100000), createdAt,
  updatedAt. Indexes on status, requestedById, assignedToId, leadId, createdAt.
  Defined in `scripts/sync-appwrite-schema.ts` — run `bun run sync:appwrite`
  (dry: `--dry-run`) to create it in Appwrite. **STILL NEEDS TO BE PUSHED.**
- **Chat model**: JSON array on the document. Each message
  `{id, team: 'sales'|'resume'|'system', senderId, senderName, body, createdAt}`.
  `team` is derived server-side (requester or dept=sales → sales, else resume);
  status changes append a `system` line. IDs use `Date.now()`+index (Math.random
  unavailable in some runtimes).
- **Types**: `CallRequest`, `CallRequestStatus`, `CALL_REQUEST_STATUSES`,
  `isValidCallRequestStatus`, `CallRequestChatMessage`, `CallRequestChatTeam`,
  `CallRequestChecklistItem` in `lib/types/index.ts`.
- **Required documents**: `lib/constants/call-request-documents.ts`
  (`REQUIRED_DOCUMENTS`). Server re-validates all confirmed on create.
- **Server action**: `app/actions/call-requests.ts` — create (Sales), list
  (Resume; TL/leadership see all, plain resume user sees assigned+unassigned),
  listMy (Sales), options (active resume users), assign (TL/leadership only),
  updateStatus, postMessage (requester or resume side only). Every mutation writes
  an `audit_logs` row (targetType `call_request`) and fires notifications.
- **Default assignment**: new requests auto-assign to a resume Team Lead
  (first alphabetically by name if multiple). The TL can reassign to any resume
  agent from the Calls page. Admin/leadership see all requests.
- **CRITICAL FIX**: `getAuthenticatedUserDoc()` in `lib/server/current-user.ts`
  previously dropped `department` (and `isActive`) from its hand-built return
  object, so every server action gating on `actor.department` treated resume
  users as sales — this is why resume TLs got "not allowed to view call requests".
  Now carries `department` (default 'sales') and `isActive`.
- **Notifications**: create → resume TLs; assign → assignee + resume TLs;
  status→pending_documents → requester + assignee + resume TLs (reminder to share
  docs/mail); other status → resume TLs; message → the other side.
- **Component keys**: `request-calls` (Sales page, in SALES_ONLY set; roles
  agent/team_lead + leadership) and `call-requests` (Resume "Calls" page; access
  map empty `[]`, opened only via the resume department short-circuit in
  `canAccess`, mirroring resume-dashboard/chat/hierarchy).
- **Pages**: `app/request-calls/page.tsx` (Sales: client list from
  `useLeadsForExportQuery` filtered by `isVisibleClientLead`, checklist dialog gate,
  my-requests list w/ chat) and `app/call-requests/page.tsx` (Resume: table with
  status select, assignee select for TL/leadership, per-row chat).
- **Shared UI**: `components/call-request-chat.tsx` — per-request chat panel used
  by both pages; sales bubbles green, resume blue, system centered italic.
- **Navigation** (`components/navigation.tsx` + `navigation-config.ts`):
  `request-calls` added to sales `agentItemKeys` (My Workspace, PhoneCall icon);
  `call-requests` added to `resumeItemKeys` + rendered as a "Calls" section
  (PhoneCall icon) in the resume-view sidebar.

## Feature: Resume team chat — COMPLETED

Resume chat already existed (`/resume-chat/[channel]` → shared `ChatChannelView`
with `department="resume"`, channels Announcement + General). Now backed by its
own **`resume_chat_messages`** table instead of the shared `chat_messages`.

- **Collection**: `COLLECTIONS.RESUME_CHAT_MESSAGES` (env
  `NEXT_PUBLIC_APPWRITE_RESUME_CHAT_MESSAGES_COLLECTION_ID`, default
  `resume_chat_messages`). Identical shape/indexes to `chat_messages`. Added to
  `scripts/sync-appwrite-schema.ts` — **STILL NEEDS `bun run sync:appwrite`.**
- **Routing**: `app/actions/chat.ts` has `chatCollectionForDepartment(dept)` —
  resume → resume table, everything else → `chat_messages`. Both list + send use
  it. Same channel model (announcement admin-only, general open); announcement
  notifications still filter recipients by department.
- **Unchanged**: sales-side system-message writes in `lib/actions/lead-actions.ts`,
  `app/actions/linkedin.ts`, and the linkedin cron stay on `CHAT_MESSAGES` (correct).
  `ChatChannelView` uses manual refresh, no realtime subscription to reroute.
- **Nav fix**: the resume sidebar's "CHATTING" section was empty because
  `chatItem` looked up key `"chat"`, which isn't in a resume user's filtered
  `itemsForUser` (only `resume-chat` is). `components/navigation.tsx` now falls
  back to the `resume-chat` item; its links already use the `/resume-chat/*` prefix.

## Fix: Browser notifications — COMPLETED

`lib/utils/notification-sound.ts`: added `primeNotificationPermission()` —
requests OS permission only from a real user gesture (Chromium ignores
`requestPermission()` otherwise; the old module-load call never prompted, so
permission stayed `default` and popups never fired). Called from the notification
bell's onClick and from the chat Send handler.

`components/notification-bell.tsx`: popup/sound now trigger for **all** unread
notification types (was two hardcoded types). Added `hasSeededRef` — the first
load seeds the "already toasted" set so a backlog of unread items doesn't pop all
at once on mount; only notifications arriving after mount pop. This also fixes
"after close it's not sharing in the chatting section" — call-request messages and
status changes now produce notifications that reliably pop.

## Fix: Resume users landed on sales /dashboard (permission error) — COMPLETED

Post-login redirects hardcoded `/dashboard`, a sales-only route. Resume-department
users (incl. resume team_lead) hit ProtectedRoute's "You don't have permission to
access dashboard". Fixed the three redirect sites to be department-aware:
- `app/login/page.tsx`: onSubmit routes off the user doc returned by `login()`
  (`department === 'resume' → /resume-dashboard`); the already-authenticated effect
  uses `homePath` from `activeDashboard`.
- `components/app-layout.tsx`: computes `homePath` from `activeDashboard` for the
  login→home redirect + its `lastRedirectPath` tracking.
- `lib/contexts/auth-context.tsx`: `login()` now returns the resolved `User` (was
  void) so the login page can route immediately without a stale-closure read;
  `AuthContextType.login` return type updated to `Promise<User | null>` in
  `lib/types/index.ts`. Other callers ignore the return — backward-compatible.
  Login test still passes (mock returns undefined → falls through to /dashboard).

## Feature: Resume Profiles Workspace & SLA Tracking (`/resume`) — COMPLETED

Tracks candidates after their introductory call (`Call done`) through the Resume team pipeline (`1. Draft`, `2. Sent`, `3. Modification /Approval`, `4. Marketing`, `5. Doc Missing`).

- **Collection**: `resume_profiles` (`COLLECTIONS.RESUME_PROFILES`, env `NEXT_PUBLIC_APPWRITE_RESUME_PROFILES_COLLECTION_ID`, default `resume_profiles`). Attributes: `candidateName`, `technology`, `usaArrival`, `callRequestId`, `stage`, `assignedToId`, `bachelors` (JSON string), `masters` (JSON string), `cpt`, `cptEmployer`, `cptJobTitle`, `cptStartDate`, `cptEndDate`, `cptI20Confirmed`, `opt`, `optEmployer`, `optJobTitle`, `optStartDate`, `optEndDate`, `optI20Confirmed`, `stemOpt`, `stemOptEmployer`, `stemOptJobTitle`, `stemOptStartDate`, `stemOptEndDate`, `stemOptConfirmed`, `indiaExperience` (JSON array of employers/dates/offer verification), `stageUpdatedAt`, `slaAlertSent`, `stageHistory` (JSON array tracking timestamps of stage movements). Added to `scripts/init-resume-profiles-collection.ts` and `scripts/sync-appwrite-schema.ts`. **Run `bun run sync:appwrite` (`--dry-run` first) or `bun scripts/init-resume-profiles-collection.ts` to sync Appwrite schema.**
- **Auto-transfer from Call Requests**: When `updateCallRequestStatusAction` (`app/actions/call-requests.ts`) sets `status === 'call_done'`, it checks if a profile exists for `callRequestId` (or matching email/phone). If not, initializes a `ResumeProfile` in `1. Draft` stage prepopulated with candidate details and assigned to the call request assignee.
- **SLA & Cron Engine (`lib/services/resume-sla-service.ts` & `app/api/cron/resume-sla/route.ts`)**: Background checks against active stage limits (`1. Draft`: 2h, `2. Sent`: 3h, `3. Modification /Approval`: 2h, `4. Marketing`: 4h, `5. Doc Missing`: Exempt). When breached, sends `resume_sla_exceeded` notification to assigned user and Resume Team Leads, and sets `slaAlertSent: true`.
- **UI Architecture (`app/resume/page.tsx` & `app/resume/[id]/page.tsx`)**:
  - `resume-profiles-client.tsx` (Table view): Features default top filter bar (Candidate/Technology search, Stage dropdown, Assigned team member filter), SLA live countdown badges (*Healthy*, *Warning <1h*, *Breached*), and quick inline stage transitions.
  - `resume-profile-detail.tsx` (Detail view at `/resume/[id]`): Deep-edit form capturing Bachelors/Masters (MM YYYY), CPT/OPT/STEM OPT verification (`I-20` / `I-983`), India experience (`Offer Letter` verification), and full audit log table of stage progression (`stageHistory`).
  - `resume-profile-modal.tsx`: Modal for manual profile creation or initialization from `Call done` call requests.
- **Access Control & Navigation**: Registered `resume-profiles` inside `lib/types/index.ts`, `lib/constants/component-access.ts`, and `lib/contexts/access-control-context.tsx` (`department === 'resume'` or leadership roles). Added to sidebar in `components/navigation.tsx` (`resumeItemKeys`) with icon in `components/navigation-config.ts`.
- **Server vs Synchronous Utilities (`lib/utils/resume-helpers.ts`)**: Synchronous utility `isResumeSide` and helpers `getResumeTeamLeads` / `getResumeTeamLeadIds` are in `lib/utils/resume-helpers.ts` (so `app/actions/call-requests.ts` only exports async server actions). Note: `resume-helpers.ts` imports `listAllDocuments` from `@/lib/server/appwrite-pagination`.
- **Notification Signature Notice**: `createNotificationsForRecipients` (`lib/server/notifications.ts`) expects 3 arguments: `(databases, recipientIds: string[], { title, body, targetId, targetType, type })`. Note that the content field is `body` (not `message`), and `targetId`/`targetType` replace `link`.

## Fix: Sales Lead Status "Signed/Closure" Cleanup — COMPLETED

- Removed `"Signed/Closure"` from `LEAD_STATUSES` array (`lib/constants/lead-status.ts`) and `SYSTEM_LEAD_FIELDS` form config (`lib/services/form-config-service.ts`), so users no longer see or select it in UI dropdowns.
- Kept `LEAD_STATUS_SIGNED_CLOSURE = "Signed/Closure"` solely inside `lib/utils/lead-status-workflow.ts` for backward-compatible normalizations (`normalizeLeadStatus` / `canonicalizeLeadStatus`), while removing it from `LEAD_WORKFLOW_STATUSES` so it does not appear in active status choices or pipeline progression checks.

## Active Problems / TODO

- **Schema push pending**: run `bun run sync:appwrite` (or `bun scripts/init-resume-profiles-collection.ts`) to create the `call_requests` and `resume_profiles` (`COLLECTIONS.RESUME_PROFILES`) collections/attributes in Appwrite before the full flow works in production.
- Temp `.tmp-followup-*.mjs` files and `debug-followup-edit-error.md` exist in repo root (pre-existing, unrelated).

## Current Focus

Schema sync in Appwrite when deploying (`bun run sync:appwrite`), then continue with any follow-up tasks or user requests.
