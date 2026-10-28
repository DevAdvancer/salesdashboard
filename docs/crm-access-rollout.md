# Native Appwrite MFA and CRM access

Every role uses password plus an emailed native Appwrite MFA code. Native MFA is mandatory by default in CRM. Appwrite handles challenge generation, delivery, verification, expiration and provider rate limits; no CRM OTP route, signed verification cookie, custom attempt table or temporary verification session remains.

The server validates the native account and session on real requests, checks activation and the CRM email match, and requires `mfa`, `emailVerification`, password plus a native second factor, and `mfaUpdatedAt` within 12 elapsed hours. Native session expiry can shorten that window. Disabling MFA never provides an access bypass: enrollment is required again. Native email is the login UI's factor; there is no attendance or role exemption.

## User experience

1. Enter email and password.
2. For an account without a verified email, complete Appwrite's one-time email ownership link. The callback consumes and removes its secret from the address bar. The user must sign into the matching account first if the link opens another browser.
3. Native MFA enrollment is automatic after email verification. Enter the six-digit code Appwrite sends to the registered email.
4. CRM mounts only after fresh server verification. At 12 hours, enter another native email code. A missing or revoked native session requires password sign-in again.

A pending native session may reject `account.get` with `user_more_factors_required`; preserve it and complete MFA before obtaining a JWT. Error and timeout states keep CRM providers blocked. Resend is user-triggered with a local cooldown; Appwrite remains responsible for rate limits. No periodic HTTP requests are needed while waiting for the code.

Attendance records, self-marking before 10 AM New York on weekdays, cover assignments for work allocation, notifications and reports remain. Absence no longer blocks access. CRM access approvals and cover-code/name entry are removed. Mutations are attributed to the signed-in account, not a covering colleague. Historical approval rows are retained as an archive.

## Cost and audit effects

Native OTP enrollment and verification run browser-to-Appwrite. Custom challenge reads, writes, attempt claims, CRM code-delivery calls and attendance/cover access reads are removed. Ordinary role, department, scoped-data and session validation still run on Vercel. Existing finite change polling remains; this migration does not restore native realtime or change Vercel performance settings.

Server account/profile helpers share the identity already checked for the current request. `getAuthenticatedUserDoc` reuses that profile even in actions without an explicit request-context wrapper, avoiding one duplicate user-document read. This adds no authorization TTL or cache across requests; later requests still reject deactivated accounts.

Actual savings depend on traffic and Appwrite pricing. Compare equivalent deployed 24-hour periods, separating Fluid memory/CPU, function invocations, database reads and email traffic. Native MFA does not eliminate Vercel security overhead or guarantee a fixed saving.

Appwrite native sessions and authentication logs provide the account/session/device/IP evidence available from the provider. A sent email alone is not a successful login. The successful MFA event/native session is the proof of code verification, and mailbox access does not prove physical identity. Existing CRM lead history still records authenticated mutations.

## Rollout and rollback

1. Run `bun run audit:native-mfa`. This is read-only, writes an ignored report under `outputs/`, and never verifies emails, enrolls users, changes passwords or revokes sessions. Resolve missing native accounts or mismatching emails before release.
2. Check all apps sharing these Appwrite accounts. MFA is account-wide: an older UK or other client that cannot finish native MFA can lock out a shared account after enrollment. Deploy compatible login flows for those apps before production enrollment. Do not bulk-enable accounts on an older deployed CRM client.
3. Run lint, Jest, typecheck, production build and local UI smoke checks. Obtain separate commit and push approvals under AGENTS.md. A push is not production verification.
4. After deployment, `/api/security/readiness` reports protocol `crm-gateway-native-mfa-v1` and `nativeMfaRequired: true`. Test a consented account's real email delivery, wrong code, correct code, page reload, logout, expired MFA, deactivation and Sales/Resume role scoping. Local mocks do not establish SMTP delivery.
5. Default enrollment happens on the user's next sign-in. Existing custom proof cookies are ignored and deleted by bridge logout; no old proof is migrated to native MFA.
6. Keep the data gateway and its authorization rules. Native collection/bucket isolation is a separate operation: `setup:crm-access:lock:dry` must show the exact changes first; apply requires the deployed new readiness protocol and saves a rollback snapshot. Do not restore raw database reads or realtime as part of MFA migration.

Rollback must preserve a client capable of completing native MFA for already-enrolled accounts. Rolling back to the removed custom OTP client can lock them out. Review a native-MFA-compatible rollback build before rollout; never disable user MFA or weaken permissions as an automatic fallback.

The retired `benchmark-crm-bootstrap`, `benchmark-linkedin-extension` and `verify-crm-email-otp` scripts minted custom proof fixtures and have been removed. Use native MFA test sessions and explicit consent for delivery tests. `security_challenges` remains for chunked resume uploads and expiry cleanup; new schema setup does not create the retired cover-approval collection.

Appwrite reference: https://appwrite.io/docs/products/auth/mfa
