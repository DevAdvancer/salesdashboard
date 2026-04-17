# Components And UI

## Layout Components

## `components/app-layout.tsx`

Responsibilities:

- Redirect unauthenticated users to `/login`
- Decide whether to render the sidebar layout
- Handle route-level loading state

Public-route handling is minimal. Right now only `/login` is treated as public.

## `components/navigation.tsx`

Responsibilities:

- Sidebar and mobile navigation
- Role-aware filtering through `useAccess()`
- Active-route highlighting
- Logout trigger

Navigation items are driven by component keys and route paths, so if a new screen is added it usually needs:

- a route
- a component key
- access-control handling
- a navigation entry if it should be visible in the sidebar

## Guard And Provider Components

## `components/protected-route.tsx`

Responsibilities:

- Enforce per-page access keys
- Redirect unauthorized users
- Show loading state while access rules are loading

## `components/azure-msal-provider.tsx`

Responsibilities:

- Client-side MSAL initialization
- Wrap children with `MsalProvider` when initialization succeeds

If MSAL is not ready, it still renders children instead of blocking the whole app.

## `components/error-boundary.tsx`

Responsibilities:

- Catch React render errors below the boundary
- Show a recovery UI
- Offer full-page reload

## Form And CRM Components

## `components/dynamic-lead-form.tsx`

Responsibilities:

- Build a dynamic form from runtime configuration
- Use generated Zod validation
- Render supported field types
- Inject assignment metadata on submit
- Hide assignment controls for agents

Important implementation details:

- `ownerId` and `assignedToId` are not treated as user-editable form fields.
- If `lastName` is missing from config, the component injects a fallback field in the rendered form.
- Agents only see visible fields.

## `components/lead-assignment-dropdown.tsx`

Responsibilities:

- Load assignable users based on creator role and branches
- Default assignment to the current user
- Hide itself for agents

## UI Primitive Layer

The `components/ui` folder contains the app's reusable presentational building blocks:

- `button.tsx`
- `card.tsx`
- `checkbox.tsx`
- `dialog.tsx`
- `input.tsx`
- `label.tsx`
- `skeleton.tsx`
- `spinner.tsx`
- `table.tsx`
- `textarea.tsx`
- `toast.tsx`
- `toaster.tsx`
- `use-toast.ts`

These are standard UI primitives used across forms, tables, dialogs, and notifications.

## Styling Model

The app uses:

- Tailwind CSS v4
- shared utility components
- dark theme shell from the root `<html className="dark">`

Fonts come from:

- `Geist`
- `Geist_Mono`

## Dashboard UI Notes

The dashboard uses:

- Cards for KPI summaries
- Recharts for financial insights
- role-conditioned sections

It is one of the best pages to inspect when understanding how roles affect presentation.

## Form Builder UI Notes

The field-management page implements:

- drag-and-drop reordering
- a detail editor panel
- a live preview panel
- publish confirmation modal

This is the most important UI for anyone extending the dynamic-form system.

## Support Workflow UI Notes

The mock, assessment, and interview pages all share a similar pattern:

- searchable lead table
- connect Outlook button
- dialog-based email composer
- file upload support
- signature preferences stored in `localStorage`

This means a change to one of those pages often needs a consistency review across the other two.
