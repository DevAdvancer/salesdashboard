# Testing And Quality

## Test Stack

Primary test stack:

- Jest
- Testing Library
- JSDOM
- Fast-check

There is also a `vitest.config.js`, but the project scripts currently point to Jest, not Vitest.

## Main Test Commands

```bash
npm run test
npm run test:watch
npm run test:coverage
```

## Jest Configuration

`jest.config.js` sets:

- `next/jest`
- `jest-environment-jsdom`
- alias mapping for `@/`
- test discovery under `tests/**/*.test.ts(x)`
- coverage collection from `app/**` and `lib/**`

## Test Folder Structure

### `tests/integration`

Covers end-to-end-ish business flows across multiple modules:

- access control flow
- form builder flow
- complete lead lifecycle
- user management flow

### `tests/property`

Covers invariants with fast-check:

- access control properties
- assignable users
- auto-ownership
- branch lead behavior
- branch service behavior
- branch subset validation
- branch-user behavior
- form config behavior
- hierarchy chains
- lead behavior
- visibility scoping
- role validation
- user behavior

This is a strong sign that the project values behavior rules more than only happy-path examples.

### `tests/unit`

Covers focused modules and UI behavior:

- dynamic lead form
- form config service
- form schema generator
- access control context
- auth flows
- error handling
- history
- lead service and UI
- navigation
- user management

## What The Tests Tell A New Maintainer

The current test suite is especially concerned with:

- hierarchy correctness
- visibility scoping
- branch constraints
- duplicate lead validation
- form config correctness
- role-based user creation

That means these are the areas where accidental regressions are most likely and most important.

## Practical Guidance Before Making Changes

If you touch any of these areas, run tests:

- user hierarchy or role logic
- branch visibility
- lead creation/assignment/closing
- form config structure
- access-control defaults

## Areas With High Regression Risk

### Multi-Manager Hierarchy Logic

Because the code supports both legacy and newer hierarchy fields, regressions can be subtle.

### Lead Visibility

Different roles use different query strategies and some of the logic is duplicated across client and server paths.

### Dynamic Form Validation

Field configuration changes can impact:

- render behavior
- validation schema generation
- default values
- hidden field handling

### Outlook Support Pages

These flows are integration-heavy and less comprehensively covered by the visible automated suite than the CRM core.

## Recommended Verification Sequence

Before merging risky work:

1. Run `npm run test`
2. Run `npm run lint`
3. Manually check:
   - `/dashboard`
   - `/leads`
   - `/users`
   - `/field-management`
   - support pages if Graph-related code changed
