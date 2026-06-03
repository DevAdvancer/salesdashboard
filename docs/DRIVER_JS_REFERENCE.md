# Driver.js — Full Reference Guide

> **Package**: `driver.js ^1.4.0`
> **Source file**: [`lib/utils/tour-guide.ts`](../lib/utils/tour-guide.ts)
> **Trigger location**: [`components/navigation.tsx`](../components/navigation.tsx) — "Page Guide" button in the sidebar footer

---

## Table of Contents

1. [Overview](#overview)
2. [How Tours Are Triggered](#how-tours-are-triggered)
3. [Global Driver.js Configuration](#global-driverjs-configuration)
4. [Tour Functions — Full Reference](#tour-functions--full-reference)
   - [startDashboardTour](#startdashboardtour)
   - [startLeadsTour](#startleadstour)
   - [startClientsTour](#startclientstour)
   - [startWorkQueueTour](#startworkqueuetour)
   - [startLeadDetailTour](#startleaddetailtour)
   - [startGenericTour](#startgenerictour)
5. [Role-Based Step Matrix](#role-based-step-matrix)
6. [All Tour Element IDs](#all-tour-element-ids)
7. [How to Use — For Agents](#how-to-use--for-agents)
8. [How to Use — For Team Leads](#how-to-use--for-team-leads)
9. [Extending Tours (Developer Notes)](#extending-tours-developer-notes)

---

## Overview

The CRM uses [Driver.js](https://driverjs.com/) to deliver **role-aware, interactive page guides**. Each guide is a sequence of highlighted UI steps called a **tour**. Tours walk users through what each section of a page does, with descriptions customized per role.

Tours are **not shown automatically**. The user starts them manually by clicking the **"Page Guide"** button in the bottom of the left sidebar.

> **Admin note**: Admins do not see the Page Guide button. Tours are only shown to all other roles.

---

## How Tours Are Triggered

The guide button lives in `components/navigation.tsx` inside the sidebar user footer:

```tsx
// Only shown to non-admin roles
{user.role !== "admin" && (
  <button onClick={() => {
    if (pathname === "/dashboard")          startDashboardTour(user.role);
    else if (pathname === "/leads")         startLeadsTour(user.role);
    else if (pathname.startsWith("/leads/")
          && pathname !== "/leads/new")     startLeadDetailTour(user.role);
    else if (pathname === "/clients")       startClientsTour(user.role);
    else if (pathname === "/work-queue")    startWorkQueueTour(user.role);
    else                                   startGenericTour();
  }}>
    Page Guide
  </button>
)}
```

**Routing logic summary:**

| Current Page | Function Called |
|---|---|
| `/dashboard` | `startDashboardTour(role)` |
| `/leads` | `startLeadsTour(role)` |
| `/leads/[id]` (not `/leads/new`) | `startLeadDetailTour(role)` |
| `/clients` | `startClientsTour(role)` |
| `/work-queue` | `startWorkQueueTour(role)` |
| Any other page | `startGenericTour()` |

---

## Global Driver.js Configuration

All tour instances share a consistent configuration:

```ts
driver({
  showProgress: true,      // Shows "Step X of Y" in popover
  animate: true,           // Smooth scroll/highlight animation
  overlayColor: 'rgba(15, 15, 14, 0.8)', // Dark semi-transparent overlay
  steps: [ ... ],
})
```

`startGenericTour` uses `showProgress: false` because it only has one step.

---

## Tour Functions — Full Reference

---

### `startDashboardTour`

**File**: `lib/utils/tour-guide.ts` — Line 5
**Page**: `/dashboard`
**Signature**: `startDashboardTour(role: UserRole): void`

This is the most role-differentiated tour. Steps are assembled conditionally based on the viewer's role.

#### Step 1 — Global Metrics *(All Roles)*

| Property | Value |
|---|---|
| **Element** | `#tour-global-metrics` |
| **Title** | Global Metrics |
| **Side** | `bottom` |
| **Align** | `start` |

**Description (all roles)**:
> "These cards give you a quick snapshot of your active leads, closed clients, and support requests."

---

#### Step 2 — Active Leads *(All Roles)*

| Property | Value |
|---|---|
| **Element** | `#tour-active-leads` |
| **Title** | Active Leads |
| **Side** | `bottom` |

**Description (all roles)**:
> "Shows the number of open leads currently assigned to you or your branch."

---

#### Step 3 — Leadership Dashboard *(Admin / Manager / Assistant Manager only)*

| Property | Value |
|---|---|
| **Element** | `#tour-leadership-dashboard` |
| **Title** | Leadership Dashboard |
| **Side** | `top` |
| **Align** | `start` |
| **Roles** | `admin`, `manager`, `assistant_manager` |

**Description**:
> "Get an overview of branch performance, team statistics, and closing ratios across your scope."

---

#### Step 3/4 — Your Work Dashboard *(Team Lead / Agent only)*

| Property | Value |
|---|---|
| **Element** | `#tour-role-work-dashboard` |
| **Title** | Your Work Dashboard |
| **Side** | `top` |
| **Align** | `start` |
| **Roles** | `team_lead`, `agent` |

**Description**:
> "Track your daily performance, target achievements, and active assignments here."

---

#### Step 4/5 — Follow-Up Queue *(All Roles, different description per role)*

| Property | Value |
|---|---|
| **Element** | `#tour-follow-up-queue` |
| **Title** | Follow-Up Queue |
| **Side** | `top` |
| **Align** | `start` |

**Description by role:**

| Role | Description |
|---|---|
| `admin` | "Never miss a follow-up. Leads needing attention are automatically queued here based on their schedules." |
| `manager` | "Track all follow-ups across your branch. Follow-ups for your agents and team leads will automatically be shown here." |
| `assistant_manager` | "Never miss a follow-up. Leads needing attention are automatically queued here based on their schedules." |
| `team_lead` | "Track your follow-ups and those of your assigned agents here." |
| `agent` | "Your assigned follow-ups will be queued here so you never miss a task." |

---

#### Step 5/6 — Financial Insights *(Admin only)*

| Property | Value |
|---|---|
| **Element** | `#tour-financial-insights` |
| **Title** | Financial Insights |
| **Side** | `top` |
| **Align** | `start` |
| **Roles** | `admin` |

**Description**:
> "High-level financial charts comparing total deal values vs. net revenue."

---

#### Step (Last) — Your Information *(All Roles)*

| Property | Value |
|---|---|
| **Element** | `#tour-user-info` |
| **Title** | Your Information |
| **Side** | `top` |

**Description (all roles)**:
> "Quickly verify your account role and reporting hierarchy."

---

### Step Count Summary — Dashboard Tour

| Role | Total Steps |
|---|---|
| `admin` | 5 |
| `manager` | 5 |
| `assistant_manager` | 5 |
| `team_lead` | 5 |
| `agent` | 5 |

> All roles get 5 steps, but **which** steps differ. Admin gets Financial Insights instead of the Work Dashboard. TLs and Agents get Work Dashboard. Managers get Leadership Dashboard.

---

### `startLeadsTour`

**File**: `lib/utils/tour-guide.ts` — Line 107
**Page**: `/leads`
**Signature**: `startLeadsTour(role: UserRole): void`

> This tour is **identical for all roles**. Role is accepted as a parameter for future expansion.

#### Step 1 — Filter Leads

| Property | Value |
|---|---|
| **Element** | `#tour-leads-filters` |
| **Title** | Filter Leads |
| **Side** | `bottom` |

**Description**:
> "Use these filters to search by name, filter by status, or narrow down by date and assigned agent."

---

#### Step 2 — Lead Actions

| Property | Value |
|---|---|
| **Element** | `#tour-leads-actions` |
| **Title** | Lead Actions |
| **Side** | `left` |

**Description**:
> "From here you can create new leads manually or export your current filtered list to CSV."

---

#### Step 3 — View Lead Details

| Property | Value |
|---|---|
| **Element** | `#tour-lead-view-btn` |
| **Title** | View Lead Details |
| **Side** | `left` |

**Description**:
> "Click \"View\" to open the detailed profile of a lead. This is where you can edit their information, add notes, and schedule follow-ups."

---

**Total Steps: 3 (all roles)**

---

### `startClientsTour`

**File**: `lib/utils/tour-guide.ts` — Line 143
**Page**: `/client`
**Signature**: `startClientsTour(role: UserRole): void`

> This tour is **identical for all roles**.

#### Step 1 — Filter Clients

| Property | Value |
|---|---|
| **Element** | `#tour-clients-filters` |
| **Title** | Filter Clients |
| **Side** | `bottom` |

**Description**:
> "Quickly find closed clients by searching or filtering by the date they were closed."

---

#### Step 2 — View Client Profile

| Property | Value |
|---|---|
| **Element** | `#tour-client-view-btn` |
| **Title** | View Client Profile |
| **Side** | `left` |

**Description**:
> "Click \"View\" to see the full details of a closed client, including their deal value and historical notes."

---

**Total Steps: 2 (all roles)**

---

### `startWorkQueueTour`

**File**: `lib/utils/tour-guide.ts` — Line 171
**Page**: `/work-queue`
**Signature**: `startWorkQueueTour(role: UserRole): void`

> This tour is **identical for all roles**.

#### Step 1 — Work Queues

| Property | Value |
|---|---|
| **Element** | `#tour-work-queue-tabs` |
| **Title** | Work Queues |
| **Side** | `bottom` |

**Description**:
> "Switch between your New Leads, Follow-ups, and Callbacks to stay on top of your daily tasks."

---

#### Step 2 — Action Leads

| Property | Value |
|---|---|
| **Element** | `#tour-work-queue-actions` |
| **Title** | Action Leads |
| **Side** | `left` |

**Description**:
> "Update statuses and log calls directly from the queue to keep your pipeline moving."

---

**Total Steps: 2 (all roles)**

---

### `startLeadDetailTour`

**File**: `lib/utils/tour-guide.ts` — Line 217
**Page**: `/leads/[id]`
**Signature**: `startLeadDetailTour(role: UserRole): void`

This tour shows a different step for managers/admins (Agent Assignment dropdown).

#### Step 1 — Lead Details *(All Roles)*

| Property | Value |
|---|---|
| **Element** | `#tour-lead-header` |
| **Title** | Lead Details |
| **Side** | `bottom` |

**Description**:
> "Here you can see the name and current status of the lead."

---

#### Step 2 — Action Buttons *(All Roles)*

| Property | Value |
|---|---|
| **Element** | `#tour-lead-actions` |
| **Title** | Action Buttons |
| **Side** | `left` |

**Description**:
> "Use these buttons to edit the lead's information or close the lead if the sales cycle is complete."

---

#### Step 3 — Lead Information *(All Roles)*

| Property | Value |
|---|---|
| **Element** | `#tour-lead-info` |
| **Title** | Lead Information |
| **Side** | `top` |

**Description**:
> "View the core details about this lead. If you enter Edit mode, you can modify these fields."

---

#### Step 4 — Agent Assignment *(Manager / Admin / Developer only)*

| Property | Value |
|---|---|
| **Element** | `#tour-lead-assignment` |
| **Title** | Agent Assignment |
| **Side** | `top` |
| **Roles** | `manager`, `admin`, `developer` |

**Description**:
> "As a manager, you can reassign this lead to a different agent from this dropdown."

---

#### Step 4/5 — Follow-ups *(All Roles)*

| Property | Value |
|---|---|
| **Element** | `#tour-lead-followup` |
| **Title** | Follow-ups |
| **Side** | `top` |

**Description**:
> "Schedule future touchpoints and view any pending follow-ups for this lead."

---

#### Step 5/6 — Internal Notes *(All Roles)*

| Property | Value |
|---|---|
| **Element** | `#tour-lead-notes` |
| **Title** | Internal Notes |
| **Side** | `top` |

**Description**:
> "Leave internal notes about your interactions. This helps the whole team stay aligned."

---

#### Step 6/7 — Activity Timeline *(All Roles)*

| Property | Value |
|---|---|
| **Element** | `#tour-lead-timeline` |
| **Title** | Activity Timeline |
| **Side** | `top` |

**Description**:
> "A complete historical log of all actions taken on this lead, including status changes and assignments."

---

### Step Count Summary — Lead Detail Tour

| Role | Total Steps |
|---|---|
| `manager`, `admin`, `developer` | 7 |
| `team_lead`, `agent` | 6 |

---

### `startGenericTour`

**File**: `lib/utils/tour-guide.ts` — Line 199
**Page**: Any page without a specific tour
**Signature**: `startGenericTour(): void`

> No element targeting — pops up as a floating popover in the center of the screen.

#### Step 1 — Navigation Guide *(All Roles)*

| Property | Value |
|---|---|
| **Element** | *(none — floating popover)* |
| **Title** | Navigation Guide |
| **showProgress** | `false` |

**Description**:
> "Use the sidebar on the left to navigate between different sections of the CRM. Click on any page to see specific tools and data."

---

**Total Steps: 1 (all roles)**

---

## Role-Based Step Matrix

This matrix shows **which steps each role sees** across all tours.

### Dashboard Tour (`/dashboard`)

| Step | Element ID | `admin` | `manager` | `asst_mgr` | `team_lead` | `agent` |
|---|---|:---:|:---:|:---:|:---:|:---:|
| Global Metrics | `#tour-global-metrics` | ✅ | ✅ | ✅ | ✅ | ✅ |
| Active Leads | `#tour-active-leads` | ✅ | ✅ | ✅ | ✅ | ✅ |
| Leadership Dashboard | `#tour-leadership-dashboard` | ✅ | ✅ | ✅ | ❌ | ❌ |
| Your Work Dashboard | `#tour-role-work-dashboard` | ❌ | ❌ | ❌ | ✅ | ✅ |
| Follow-Up Queue | `#tour-follow-up-queue` | ✅ | ✅ | ✅ | ✅ | ✅ |
| Financial Insights | `#tour-financial-insights` | ✅ | ❌ | ❌ | ❌ | ❌ |
| Your Information | `#tour-user-info` | ✅ | ✅ | ✅ | ✅ | ✅ |

### Leads Tour (`/leads`)

| Step | Element ID | All Roles |
|---|---|:---:|
| Filter Leads | `#tour-leads-filters` | ✅ |
| Lead Actions | `#tour-leads-actions` | ✅ |
| View Lead Details | `#tour-lead-view-btn` | ✅ |

### Lead Detail Tour (`/leads/[id]`)

| Step | Element ID | `admin`/`manager`/`developer` | `team_lead` | `agent` |
|---|---|:---:|:---:|:---:|
| Lead Details | `#tour-lead-header` | ✅ | ✅ | ✅ |
| Action Buttons | `#tour-lead-actions` | ✅ | ✅ | ✅ |
| Lead Information | `#tour-lead-info` | ✅ | ✅ | ✅ |
| Agent Assignment | `#tour-lead-assignment` | ✅ | ❌ | ❌ |
| Follow-ups | `#tour-lead-followup` | ✅ | ✅ | ✅ |
| Internal Notes | `#tour-lead-notes` | ✅ | ✅ | ✅ |
| Activity Timeline | `#tour-lead-timeline` | ✅ | ✅ | ✅ |

### Clients Tour (`/client`)

| Step | Element ID | All Roles |
|---|---|:---:|
| Filter Clients | `#tour-clients-filters` | ✅ |
| View Client Profile | `#tour-client-view-btn` | ✅ |

### Work Queue Tour (`/work-queue`)

| Step | Element ID | All Roles |
|---|---|:---:|
| Work Queues | `#tour-work-queue-tabs` | ✅ |
| Action Leads | `#tour-work-queue-actions` | ✅ |

---

## All Tour Element IDs

The following HTML element IDs must exist on the page for their respective tour steps to highlight correctly. If an element ID is missing or not rendered, driver.js will skip that step silently.

| Element ID | Page | Notes |
|---|---|---|
| `#tour-global-metrics` | `/dashboard` | KPI metrics card group |
| `#tour-active-leads` | `/dashboard` | Active leads count card |
| `#tour-leadership-dashboard` | `/dashboard` | Manager/admin stats section |
| `#tour-role-work-dashboard` | `/dashboard` | Agent/TL performance section |
| `#tour-follow-up-queue` | `/dashboard` | Follow-up queue widget |
| `#tour-financial-insights` | `/dashboard` | Admin financial charts |
| `#tour-user-info` | `/dashboard` | Current user info card |
| `#tour-leads-filters` | `/leads` | Filter bar/panel |
| `#tour-leads-actions` | `/leads` | Create/export button group |
| `#tour-lead-view-btn` | `/leads` | First "View" button in table |
| `#tour-clients-filters` | `/client` | Filter bar/panel |
| `#tour-client-view-btn` | `/client` | First "View" button in table |
| `#tour-work-queue-tabs` | `/work-queue` | New/Follow-up/Callback tabs |
| `#tour-work-queue-actions` | `/work-queue` | Lead action buttons |
| `#tour-lead-header` | `/leads/[id]` | Lead name + status header |
| `#tour-lead-actions` | `/leads/[id]` | Edit/Close button group |
| `#tour-lead-info` | `/leads/[id]` | Lead info fields panel |
| `#tour-lead-assignment` | `/leads/[id]` | Assignee dropdown (mgr/admin) |
| `#tour-lead-followup` | `/leads/[id]` | Follow-up scheduler section |
| `#tour-lead-notes` | `/leads/[id]` | Internal notes panel |
| `#tour-lead-timeline` | `/leads/[id]` | Activity timeline section |

---

## How to Use — For Agents

As an **Agent**, you have access to page guides on the following pages. Here's what each guide covers and what to expect:

---

### 📊 Dashboard Guide

**How to start:** Navigate to `/dashboard`, then click **"Page Guide"** at the bottom of the sidebar.

**What you'll see (5 steps):**

1. **Global Metrics** — The card row at the top shows your active leads, closed clients, and support requests. This is your daily at-a-glance health check.

2. **Active Leads** — This number tells you exactly how many open leads are waiting on you right now.

3. **Your Work Dashboard** — This is your personal performance hub. Check your daily targets, number of calls made, and how close you are to your goals.

4. **Follow-Up Queue** — This queue is auto-populated with leads that are due for a follow-up based on their last interaction date. Work through this list every day.

5. **Your Information** — Confirms your account role and shows your team lead and manager. Useful to verify your access level.

---

### 📋 Leads Guide

**How to start:** Navigate to `/leads`, then click **"Page Guide"**.

**What you'll see (3 steps):**

1. **Filter Leads** — Use the search bar and dropdowns to find specific leads. You can filter by name, status, date range, or agent.

2. **Lead Actions** — Use the "New Lead" button to add a new prospect. The "Export" button downloads your current filtered list as a CSV file.

3. **View Lead Details** — Click the "View" button on any row to open the full lead profile where you can edit details, add notes, and schedule follow-ups.

---

### 🔍 Lead Detail Guide

**How to start:** Open any lead from `/leads`, then click **"Page Guide"**.

**What you'll see (6 steps):**

1. **Lead Details** — The header shows the lead's name and current status (e.g., Active, Callback, Closed).

2. **Action Buttons** — Click "Edit" to enter edit mode and change field values. Click "Close Lead" when a deal is finalized to move the lead to client history.

3. **Lead Information** — This panel shows all the fields for the lead. In edit mode, you can update any unlocked field.

4. **Follow-ups** — Schedule your next touchpoint here. The system will surface this lead in your Follow-Up Queue at the right time.

5. **Internal Notes** — Leave notes after every call or meeting. Notes are visible to your team lead and manager, so keep them professional and accurate.

6. **Activity Timeline** — A full log of everything that has happened on this lead: status changes, assignments, and note history.

---

### 📁 Clients Guide

**How to start:** Navigate to `/client`, then click **"Page Guide"**.

**What you'll see (2 steps):**

1. **Filter Clients** — Search by name or filter by the date a client was closed to find historical records.

2. **View Client Profile** — Click "View" to see the complete read-only record of a closed client, including deal value and all historical notes.

---

### ✅ Work Queue Guide

**How to start:** Navigate to `/work-queue`, then click **"Page Guide"**.

**What you'll see (2 steps):**

1. **Work Queues** — Three tabs: **New Leads** (fresh assignments), **Follow-ups** (scheduled call-backs), and **Callbacks** (leads that requested a specific time). Switch between them throughout your day.

2. **Action Leads** — Use the action buttons on each row to update a lead's status or log a call without opening the full lead profile.

---

### 🧭 Other Pages

On any page that doesn't have a dedicated tour (e.g., Settings, Audit Logs), clicking **"Page Guide"** will show a floating **Navigation Guide** popup reminding you how to navigate between sections using the sidebar.

---

## How to Use — For Team Leads

As a **Team Lead**, your tours cover the same pages as agents but with additional context about team-wide visibility.

---

### 📊 Dashboard Guide

**How to start:** Navigate to `/dashboard`, then click **"Page Guide"** at the bottom of the sidebar.

**What you'll see (5 steps):**

1. **Global Metrics** — These top-level cards cover leads, clients, and support activity for your team's scope. This reflects your agents' work, not just your own.

2. **Active Leads** — The total count of open leads across yourself and your assigned agents.

3. **Your Work Dashboard** — Your personal performance panel. Even as a team lead, you handle your own leads alongside managing your agents.

4. **Follow-Up Queue** — This queue shows **both your follow-ups and your agents' follow-ups**. As TL, you're responsible for ensuring your team's follow-ups are being handled.

5. **Your Information** — Confirms your role as Team Lead and shows who your reporting manager is.

---

### 📋 Leads Guide

**How to start:** Navigate to `/leads`, then click **"Page Guide"**.

**What you'll see (3 steps):**

1. **Filter Leads** — Filter across all leads visible to you — your own leads **and** those assigned to your agents.

2. **Lead Actions** — Create new leads for yourself or export a filtered list. As a TL, you may also create leads and assign them directly to one of your agents.

3. **View Lead Details** — Click "View" on any row to inspect a lead. You can review agent progress on leads without editing them unless you are the owner or assignee.

---

### 🔍 Lead Detail Guide

**How to start:** Open any lead from `/leads`, then click **"Page Guide"**.

**What you'll see (6 steps):**

> **Note**: Team Leads do **not** see the Agent Assignment step. Only managers and admins can reassign leads from this view.

1. **Lead Details** — Name and current status of the lead.

2. **Action Buttons** — Edit or close leads that you own. For leads assigned to your agents, your ability to edit depends on your access permissions.

3. **Lead Information** — All field values for this lead. In edit mode, you can update any unlocked field on leads you have write access to.

4. **Follow-ups** — View or schedule follow-ups. You can see scheduled touchpoints for your agents' leads here too.

5. **Internal Notes** — All team notes are visible here. Use this to coach agents by leaving guidance notes or to track your own observations on a lead.

6. **Activity Timeline** — The full audit history of this lead. As a TL, this is useful for reviewing what your agents have done on a particular lead.

---

### 📁 Clients Guide

**How to start:** Navigate to `/client`, then click **"Page Guide"**.

**What you'll see (2 steps):**

1. **Filter Clients** — Search across all closed clients visible to your scope (yours and your agents').

2. **View Client Profile** — Read-only view of a closed lead. As TL, you may be able to request a reopen through your manager.

---

### ✅ Work Queue Guide

**How to start:** Navigate to `/work-queue`, then click **"Page Guide"**.

**What you'll see (2 steps):**

1. **Work Queues** — Tabs covering New Leads, Follow-ups, and Callbacks. As a TL, this shows work items that belong to you. Use this to manage your personal pipeline while your agents manage theirs.

2. **Action Leads** — Quick-action buttons to update statuses or log calls without navigating into the full lead detail view.

---

### 🧭 Other Pages

For any page without a dedicated tour, the **Navigation Guide** popup will appear with a reminder about sidebar navigation.

---

## Extending Tours (Developer Notes)

### Adding a New Step to an Existing Tour

1. Open `lib/utils/tour-guide.ts`.
2. Find the relevant tour function (e.g., `startLeadsTour`).
3. Add a new step object to the `steps` array:

```ts
{
  element: '#your-new-element-id',
  popover: {
    title: 'Step Title',
    description: 'What this section does.',
    side: 'bottom', // 'top' | 'bottom' | 'left' | 'right'
    align: 'start', // 'start' | 'center' | 'end'  (optional)
  },
}
```

4. Add `id="your-new-element-id"` to the corresponding JSX element on the page.

### Adding a New Tour for a New Page

1. Create a new exported function in `lib/utils/tour-guide.ts`:

```ts
export function startMyNewPageTour(role: UserRole) {
  const steps = [
    // ... your steps
  ];

  driver({
    showProgress: true,
    animate: true,
    overlayColor: 'rgba(15, 15, 14, 0.8)',
    steps: steps as any,
  }).drive();
}
```

2. Import the function in `components/navigation.tsx`.
3. Add a new `else if` branch in the Page Guide button's `onClick` handler:

```ts
else if (pathname === "/my-new-page") startMyNewPageTour(user.role);
```

### Role Condition Reference

```ts
const isAdmin    = role === 'admin' || role === 'developer';
const isManager  = role === 'manager' || role === 'assistant_manager';
const isTeamLead = role === 'team_lead';
const isAgent    = role === 'agent';
```

Use these booleans to conditionally `push()` role-specific steps into the `steps` array before calling `driver().drive()`.

### Driver.js Popover Options

| Option | Type | Values | Default |
|---|---|---|---|
| `title` | `string` | Any text | — |
| `description` | `string` | Any text / HTML | — |
| `side` | `string` | `top`, `bottom`, `left`, `right` | `bottom` |
| `align` | `string` | `start`, `center`, `end` | `center` |
| `showButtons` | `string[]` | `['next', 'previous', 'close']` | all |
| `nextBtnText` | `string` | Custom label | `Next →` |
| `prevBtnText` | `string` | Custom label | `← Previous` |
| `doneBtnText` | `string` | Custom label | `Done` |

### Common Issues

| Issue | Likely Cause | Fix |
|---|---|---|
| Step skips / no highlight | Element ID not found in DOM | Verify `id="..."` exists and is rendered |
| Tour starts on wrong element | Stale DOM / animation delay | Wrap in `setTimeout(() => driverObj.drive(), 100)` |
| Popover clips off screen | `side` direction off-screen | Change `side` to opposite direction |
| Tour not appearing | `admin` role check | Only non-admin roles see the Page Guide button |
