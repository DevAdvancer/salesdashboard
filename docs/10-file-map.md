# File Map

This file is the quick reference for where the important implementation lives.

## Top Level

| Path | Purpose |
| --- | --- |
| `app/` | Next.js App Router pages, server actions, and API routes |
| `components/` | Shared layout, CRM, and UI components |
| `lib/` | Clients, services, contexts, utils, types, and constants |
| `public/` | Static assets |
| `scripts/` | Manual maintenance scripts |
| `tests/` | Unit, integration, and property tests |
| `README.md` | Older project overview |
| `SETUP.md` | Older setup guide |
| `next.config.ts` | Next.js + Sentry config |
| `instrumentation.ts` | Runtime Sentry registration |
| `instrumentation-client.ts` | Browser Sentry initialization |
| `jest.config.js` | Jest config |
| `vitest.config.js` | Vitest config |
| `eslint.config.mjs` | ESLint config |

## `app/`

### Root And Global Files

| Path | Purpose |
| --- | --- |
| `app/layout.tsx` | Root provider/layout chain |
| `app/page.tsx` | Entry redirect page |
| `app/global-error.tsx` | Global route error UI |
| `app/globals.css` | Global styles |

### CRM Pages

| Path | Purpose |
| --- | --- |
| `app/dashboard/page.tsx` | Dashboard and KPI view |
| `app/leads/page.tsx` | Active leads list |
| `app/leads/new/page.tsx` | Lead creation |
| `app/leads/[id]/page.tsx` | Lead detail/edit/assign/close |
| `app/client/page.tsx` | Closed leads list |
| `app/client/[id]/page.tsx` | Closed lead detail and reopen flow |
| `app/users/page.tsx` | User management UI |
| `app/branches/page.tsx` | Branch management |
| `app/field-management/page.tsx` | Dynamic field configuration |
| `app/hierarchy/page.tsx` | Hierarchy tree view |
| `app/audit-logs/page.tsx` | Audit log viewer |
| `app/settings/page.tsx` | Redirect to access settings |
| `app/settings/access/page.tsx` | Access-rule editor |

### Support Workflow Pages

| Path | Purpose |
| --- | --- |
| `app/mock/page.tsx` | Mock interview workflow |
| `app/assessment-support/page.tsx` | Assessment support workflow |
| `app/interview-support/page.tsx` | Interview support workflow |

### Auth And Debug Pages

| Path | Purpose |
| --- | --- |
| `app/login/page.tsx` | Login screen |
| `app/signup/page.tsx` | Signup screen |
| `app/auth-test/page.tsx` | Auth context debug page |
| `app/test-auth/page.tsx` | Appwrite auth/db manual test page |
| `app/sentry-example-page/page.tsx` | Sentry sample page |

### Server Actions

| Path | Purpose |
| --- | --- |
| `app/actions/lead.ts` | Lead server actions |
| `app/actions/user.ts` | User server actions |
| `app/actions/mock.ts` | Mock attempt tracking |
| `app/actions/assessment.ts` | Assessment attempt tracking and subject dedupe |
| `app/actions/interview.ts` | Interview attempt tracking and subject dedupe |

### API Routes

| Path | Purpose |
| --- | --- |
| `app/api/auth/login/route.ts` | Azure auth start |
| `app/api/auth/callback/route.ts` | Azure token callback |
| `app/api/auth/status/route.ts` | Outlook connection status |
| `app/api/mock/send-email/route.ts` | Mock email send proxy |
| `app/api/assessment/send-email/route.ts` | Assessment email send proxy |
| `app/api/interview/send-email/route.ts` | Interview email send proxy |
| `app/api/debug-config/route.ts` | Debug config endpoint |
| `app/api/sentry-example-api/route.ts` | Sentry sample endpoint |

## `components/`

### Application Components

| Path | Purpose |
| --- | --- |
| `components/app-layout.tsx` | Main shell layout |
| `components/navigation.tsx` | Sidebar/mobile navigation |
| `components/protected-route.tsx` | Per-page access guard |
| `components/error-boundary.tsx` | React error boundary |
| `components/azure-msal-provider.tsx` | MSAL provider setup |
| `components/dynamic-lead-form.tsx` | Runtime-configured lead form |
| `components/lead-assignment-dropdown.tsx` | Role-aware lead assignment UI |

### UI Primitives

| Path | Purpose |
| --- | --- |
| `components/ui/button.tsx` | Button primitive |
| `components/ui/card.tsx` | Card primitive |
| `components/ui/checkbox.tsx` | Checkbox primitive |
| `components/ui/dialog.tsx` | Dialog primitive |
| `components/ui/input.tsx` | Input primitive |
| `components/ui/label.tsx` | Label primitive |
| `components/ui/skeleton.tsx` | Loading skeletons |
| `components/ui/spinner.tsx` | Spinner |
| `components/ui/table.tsx` | Table primitive |
| `components/ui/textarea.tsx` | Textarea primitive |
| `components/ui/toast.tsx` | Toast primitive |
| `components/ui/toaster.tsx` | Toast renderer |
| `components/ui/use-toast.ts` | Toast hook |

## `lib/`

### Clients And Config

| Path | Purpose |
| --- | --- |
| `lib/appwrite.ts` | Client-side Appwrite SDK |
| `lib/server/appwrite.ts` | Server-side Appwrite clients |
| `lib/msal-config.ts` | Browser MSAL config |
| `lib/msal-server-config.ts` | Server MSAL config |
| `lib/utils.ts` | Shared utility helpers |

### Constants

| Path | Purpose |
| --- | --- |
| `lib/constants/appwrite.ts` | Database and collection IDs |
| `lib/constants/default-access.ts` | Default access rules |
| `lib/constants/default-fields.ts` | Default field config reference |

### Contexts

| Path | Purpose |
| --- | --- |
| `lib/contexts/auth-context.tsx` | Appwrite auth context |
| `lib/contexts/access-control-context.tsx` | Role/component access context |

### Hooks

| Path | Purpose |
| --- | --- |
| `lib/hooks/use-debounce.ts` | Debounce hook used by support pages |

### Services

| Path | Purpose |
| --- | --- |
| `lib/services/audit-service.ts` | Audit log CRUD |
| `lib/services/branch-service.ts` | Branch CRUD and stats |
| `lib/services/form-config-service.ts` | Dynamic form config CRUD |
| `lib/services/lead-service.ts` | Lead CRUD, visibility, assignment, close/reopen |
| `lib/services/lead-validator.ts` | Duplicate lead validation |
| `lib/services/user-service.ts` | User creation and hierarchy helpers |

### Actions / Utils / Types

| Path | Purpose |
| --- | --- |
| `lib/actions/lead-actions.ts` | Lead action helpers |
| `lib/types/index.ts` | Shared domain types |
| `lib/utils/branch-visibility.ts` | Branch filtering helper |
| `lib/utils/error-handler.ts` | Toast + Sentry error helpers |
| `lib/utils/form-schema-generator.ts` | Dynamic Zod schema generation |
| `lib/utils/form-schema-generator.README.md` | Schema generator notes |
| `lib/utils/form-schema-generator.example.tsx` | Example usage for generator |

## `scripts/`

| Path | Purpose |
| --- | --- |
| `scripts/reopen-lead-worker.ts` | Manual reopen repair script |
| `scripts/update-role-enum.ts` | Update Appwrite role enum attribute |

## `tests/`

### Integration Tests

| Path | Purpose |
| --- | --- |
| `tests/integration/access-control-flow.test.ts` | End-to-end access flow |
| `tests/integration/form-builder-flow.test.ts` | Form builder lifecycle |
| `tests/integration/lead-lifecycle.test.ts` | Lead lifecycle flow |
| `tests/integration/user-management-flow.test.ts` | User lifecycle flow |

### Property Tests

| Path | Purpose |
| --- | --- |
| `tests/property/access-properties.test.ts` | Access invariants |
| `tests/property/assignable-users-properties.test.ts` | Assignable user rules |
| `tests/property/auto-ownership-properties.test.ts` | Lead owner invariants |
| `tests/property/branch-lead-properties.test.ts` | Branch + lead invariants |
| `tests/property/branch-properties.test.ts` | Branch service invariants |
| `tests/property/branch-subset-validation-properties.test.ts` | Branch subset rules |
| `tests/property/branch-user-properties.test.ts` | Branch + user invariants |
| `tests/property/form-properties.test.ts` | Form config invariants |
| `tests/property/hierarchy-chain-properties.test.ts` | Hierarchy chain rules |
| `tests/property/lead-properties.test.ts` | Lead invariants |
| `tests/property/lead-visibility-scoping-properties.test.ts` | Lead visibility rules |
| `tests/property/role-validation-properties.test.ts` | Role validation rules |
| `tests/property/user-properties.test.ts` | User invariants |
| `tests/property/user-visibility-scoping-properties.test.ts` | User visibility rules |

### Unit Tests

| Path | Purpose |
| --- | --- |
| `tests/unit/dynamic-lead-form.test.tsx` | Dynamic form rendering/validation |
| `tests/unit/form-config-service.test.ts` | Form config service |
| `tests/unit/form-schema-generator.test.ts` | Schema generator |
| `tests/unit/access/access-control.test.tsx` | Access context |
| `tests/unit/auth/auth-context-signup.test.tsx` | Signup context behavior |
| `tests/unit/auth/auth-context.test.tsx` | Auth context behavior |
| `tests/unit/auth/authentication-flows.test.tsx` | Auth flow behavior |
| `tests/unit/auth/login.test.tsx` | Login screen |
| `tests/unit/auth/session-persistence.test.tsx` | Session persistence |
| `tests/unit/auth/signup.test.tsx` | Signup screen |
| `tests/unit/error-handling/error-boundary.test.tsx` | Error boundary |
| `tests/unit/error-handling/error-handler.test.ts` | Error utility helpers |
| `tests/unit/error-handling/network-errors.test.ts` | Network error behavior |
| `tests/unit/error-handling/permission-errors.test.tsx` | Permission error behavior |
| `tests/unit/error-handling/validation-errors.test.tsx` | Validation error behavior |
| `tests/unit/history/history.test.ts` | History page logic |
| `tests/unit/leads/lead-service.test.ts` | Lead service |
| `tests/unit/leads/lead-ui.test.tsx` | Lead UI behavior |
| `tests/unit/leads/lead-visibility-branches.test.ts` | Lead branch visibility |
| `tests/unit/navigation/navigation.test.tsx` | Navigation behavior |
| `tests/unit/users/admin-manager-creation.test.ts` | Admin/manager creation flows |
| `tests/unit/users/branch-visibility.test.ts` | Branch visibility helper |
| `tests/unit/users/manager-user-visibility.test.ts` | Manager user visibility |
| `tests/unit/users/user-creation-regression.test.ts` | User creation regressions |
| `tests/unit/users/user-management.test.ts` | User management logic |
