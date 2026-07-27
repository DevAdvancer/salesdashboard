/**
 * Runs via `setupFiles`, before the test framework and before any test file
 * imports application code.
 *
 * Several modules build an Appwrite client at module scope, for example
 * lib/appwrite.ts calls `new Client().setEndpoint(process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT)`
 * on import. The SDK throws "Endpoint must be a valid string" when that value is
 * undefined, which fails the whole suite at import time rather than at any
 * assertion. `.env` files are gitignored, so a fresh checkout has nothing to
 * load and the failure is guaranteed on any machine that has not created one.
 *
 * These values are deliberately obvious placeholders. Nothing in the suite may
 * talk to a real Appwrite project: `fetch` is mocked in jest.setup.js, and the
 * SDK is mocked per test file.
 */

const TEST_ENV = {
  NEXT_PUBLIC_APPWRITE_ENDPOINT: 'https://appwrite.test/v1',
  NEXT_PUBLIC_APPWRITE_PROJECT_ID: 'test-project',
  APPWRITE_API_KEY: 'test-api-key',
  NEXT_PUBLIC_APPWRITE_DATABASE_ID: 'test-database',
  NEXT_PUBLIC_APPWRITE_USERS_COLLECTION_ID: 'test-users-collection',
  NEXT_PUBLIC_APPWRITE_LEADS_COLLECTION_ID: 'test-leads-collection',
  NEXT_PUBLIC_APPWRITE_BRANCHES_COLLECTION_ID: 'test-branches-collection',
  NEXT_PUBLIC_APPWRITE_FORM_CONFIG_COLLECTION_ID: 'test-form-config-collection',
  NEXT_PUBLIC_APPWRITE_ACCESS_CONFIG_COLLECTION_ID: 'test-access-config-collection',
  NEXT_PUBLIC_APPWRITE_AUDIT_LOGS_COLLECTION_ID: 'test-audit-logs-collection',
  NEXT_PUBLIC_APPWRITE_NOTIFICATIONS_COLLECTION_ID: 'test-notifications-collection',
  NEXT_PUBLIC_APPWRITE_ATTENDANCE_COLLECTION_ID: 'test-attendance-collection',
  NEXT_PUBLIC_APPWRITE_CLIENT_PAYMENTS_COLLECTION_ID: 'test-client-payments-collection',
  NEXT_PUBLIC_APPWRITE_LINKEDIN_ACCOUNTS_COLLECTION_ID: 'test-linkedin-accounts-collection',
  NEXT_PUBLIC_APPWRITE_LINKEDIN_REQUESTS_COLLECTION_ID: 'test-linkedin-requests-collection',
  NEXT_PUBLIC_APPWRITE_RESUMES_BUCKET_ID: 'test-resumes-bucket',
  CRON_SECRET: 'test-cron-secret',
};

// Never clobber a value the developer set deliberately, so a targeted run such
// as APPWRITE_API_KEY=... npx jest still behaves as intended.
for (const [key, value] of Object.entries(TEST_ENV)) {
  if (!process.env[key]) process.env[key] = value;
}

// jsdom does not provide TextEncoder / TextDecoder. jest.setup.js also sets
// these, but it runs after this file and after module-scope code in anything a
// test imports.
// This file is loaded by Jest via setupFiles as CommonJS, before any ESM
// transform applies, so require is the only form that works here.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { TextEncoder, TextDecoder } = require('util');
if (typeof globalThis.TextEncoder === 'undefined') globalThis.TextEncoder = TextEncoder;
if (typeof globalThis.TextDecoder === 'undefined') globalThis.TextDecoder = TextDecoder;

// Deliberately NOT installing undici's Request / Response / Headers here. undici
// reaches for ReadableStream, MessagePort and other web globals that jsdom does
// not define, so requiring it fails the entire suite at setup. Nothing in this
// suite needs a real fetch implementation: fetch is mocked in jest.setup.js, and
// the two route-handler tests that need Request build it themselves.
