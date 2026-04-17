# Setup And Environment

## Local Prerequisites

You need:

- Node.js 20+
- `npm`
- An Appwrite project
- Azure app credentials if Outlook features are required

## Install And Run

```bash
npm install
npm run dev
```

The dev server runs on port `5000`, because `package.json` defines:

```json
"dev": "next dev -p 5000"
```

Use `http://localhost:5000`.

## Available Package Scripts

Current `package.json` scripts:

- `npm run dev`
- `npm run build`
- `npm run start`
- `npm run lint`
- `npm run test`
- `npm run test:watch`
- `npm run test:coverage`
- `npm run setup:appwrite`
- `npm run verify:appwrite`
- `npm run promote-admin`

Important note:

- The repo currently contains only `scripts/reopen-lead-worker.ts` and `scripts/update-role-enum.ts`.
- The files referenced by `setup:appwrite`, `verify:appwrite`, and `promote-admin` are not present right now.

Anyone onboarding should know those three scripts are currently stale references unless the missing files are restored from another branch or were intentionally removed.

## Environment Variables Actually Used By The Code

The checked-in `.env.local.example` is incomplete. The code currently reads the variables below.

| Variable | Required | Used For |
| --- | --- | --- |
| `NEXT_PUBLIC_APPWRITE_ENDPOINT` | Yes | Appwrite endpoint |
| `NEXT_PUBLIC_APPWRITE_PROJECT_ID` | Yes | Appwrite project |
| `NEXT_PUBLIC_APPWRITE_DATABASE_ID` | Yes | Main database |
| `NEXT_PUBLIC_APPWRITE_USERS_COLLECTION_ID` | Yes | Users collection |
| `NEXT_PUBLIC_APPWRITE_LEADS_COLLECTION_ID` | Yes | Leads collection |
| `NEXT_PUBLIC_APPWRITE_FORM_CONFIG_COLLECTION_ID` | Yes | Form config singleton |
| `NEXT_PUBLIC_APPWRITE_ACCESS_CONFIG_COLLECTION_ID` | Yes | UI access rules |
| `NEXT_PUBLIC_APPWRITE_BRANCHES_COLLECTION_ID` | Yes | Branch management |
| `NEXT_PUBLIC_APPWRITE_MOCK_ATTEMPTS_COLLECTION_ID` | Needed for mock feature | Mock attempt tracking |
| `NEXT_PUBLIC_APPWRITE_ASSESSMENT_ATTEMPTS_COLLECTION_ID` | Needed for assessment feature | Assessment attempt tracking |
| `NEXT_PUBLIC_APPWRITE_INTERVIEW_ATTEMPTS_COLLECTION_ID` | Needed for interview feature | Interview attempt tracking |
| `NEXT_PUBLIC_APPWRITE_AUDIT_LOGS_COLLECTION_ID` | Needed for audit logs | Audit collection |
| `APPWRITE_API_KEY` | Needed for admin scripts/server admin actions | Privileged Appwrite access |
| `NEXT_PUBLIC_AZURE_CLIENT_ID` | Needed for Outlook features | Azure auth |
| `NEXT_PUBLIC_AZURE_TENANT_ID` | Needed for Outlook features | Azure tenant |
| `NEXT_PUBLIC_AZURE_REDIRECT_URI` | Needed for Outlook features | Azure callback URI |
| `AZURE_CLIENT_SECRET` | Needed for Outlook features | Server-side token exchange |
| `NEXT_PUBLIC_SENTRY_DSN` | Optional but recommended | Sentry browser monitoring |

## Minimum Useful `.env.local`

Use this as a practical starting point:

```env
NEXT_PUBLIC_APPWRITE_ENDPOINT=https://cloud.appwrite.io/v1
NEXT_PUBLIC_APPWRITE_PROJECT_ID=your-project-id
NEXT_PUBLIC_APPWRITE_DATABASE_ID=crm-database-1

NEXT_PUBLIC_APPWRITE_USERS_COLLECTION_ID=users
NEXT_PUBLIC_APPWRITE_LEADS_COLLECTION_ID=leads
NEXT_PUBLIC_APPWRITE_FORM_CONFIG_COLLECTION_ID=form_config
NEXT_PUBLIC_APPWRITE_ACCESS_CONFIG_COLLECTION_ID=access_config
NEXT_PUBLIC_APPWRITE_BRANCHES_COLLECTION_ID=branches
NEXT_PUBLIC_APPWRITE_MOCK_ATTEMPTS_COLLECTION_ID=mock_attempts
NEXT_PUBLIC_APPWRITE_ASSESSMENT_ATTEMPTS_COLLECTION_ID=assessment_attempts
NEXT_PUBLIC_APPWRITE_INTERVIEW_ATTEMPTS_COLLECTION_ID=interview_attempts
NEXT_PUBLIC_APPWRITE_AUDIT_LOGS_COLLECTION_ID=audit_logs

APPWRITE_API_KEY=your-appwrite-api-key

NEXT_PUBLIC_AZURE_CLIENT_ID=your-azure-client-id
NEXT_PUBLIC_AZURE_TENANT_ID=your-tenant-id-or-common
NEXT_PUBLIC_AZURE_REDIRECT_URI=http://localhost:5000
AZURE_CLIENT_SECRET=your-azure-client-secret

NEXT_PUBLIC_SENTRY_DSN=your-sentry-dsn
```

## Appwrite Setup Expectations

The application assumes these logical collections exist:

- `users`
- `leads`
- `form_config`
- `access_config`
- `branches`
- `mock_attempts`
- `assessment_attempts`
- `interview_attempts`
- `audit_logs`

It also assumes:

- Appwrite Email/Password auth is enabled.
- The frontend project can create sessions.
- The admin API key can create and update documents where server actions need elevated access.

## Azure / Outlook Setup Expectations

Outlook features depend on Azure AD and Microsoft Graph.

The code expects:

- Redirect flow initiated by `/api/auth/login`
- Callback handled by `/api/auth/callback`
- `Mail.Send` and `User.Read` scopes
- Access token stored in an HTTP-only cookie named `outlook_access_token`

If Azure is not configured, the main CRM can still work, but the mock, assessment, and interview email features will not.

## Sentry

Sentry is wired through:

- `next.config.ts`
- `instrumentation.ts`
- `instrumentation-client.ts`
- `sentry.server.config.ts`
- `sentry.edge.config.ts`

If `NEXT_PUBLIC_SENTRY_DSN` is omitted, monitoring will be reduced or unavailable.

## Important Setup Drift To Know

### 1. The Example Env File Is Incomplete

`.env.local.example` currently only documents the base Appwrite variables. It does not include:

- Audit collection ID
- Attempt collection IDs
- Azure config
- Appwrite admin API key
- Sentry DSN

### 2. Older Docs Mention Port 3000

The current app runs on `5000`, not `3000`.

### 3. Script References Are Partly Out Of Date

`package.json` references setup/verification/admin scripts that are not currently present in `scripts/`.
