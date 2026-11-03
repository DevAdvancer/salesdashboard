# Appwrite user impersonation

The user-switching control is available to any active CRM account whose native
Appwrite Auth account has `impersonator: true`. A CRM role alone does not grant
this capability, and the CRM does not enable it on anyone's account.

The operator signs in with their own password and native MFA. They can enter a
CRM user's email or Appwrite user ID and explicitly start impersonating. The
selected user's role, department and existing CRM data scopes apply. A visible
banner identifies both people and provides **Stop impersonating**. Logging out
also clears impersonation.

## Authentication and authorization

- `/api/security/impersonation` authorizes its own requests and checks the origin
  of mutations. Stop remains available after permission or session revocation.
- The HttpOnly, SameSite target cookie is only a selector. Each impersonated
  request bypasses settled identity caches, access cookies and internal access
  passes. It reads the operator's native session, MFA and current capability.
- The existing SDK supports custom REST headers. The CRM requests response format
  `1.9.0` and sends `X-Appwrite-Impersonate-User-Id` on that same authenticated
  Appwrite client. It accepts the result only when Appwrite confirms the exact
  target and `impersonatorUserId` matches the original operator.
- Both CRM profiles must remain active and match their native account emails.
  Impersonation never uses an API key as proof that the operator is authorized.
- Native browser Auth remains attached to the operator for MFA, JWT rotation and
  sign-out. CRM bootstrap and server actions use the effective target identity.
- Switching clears browser query persistence and reloads the application. Other
  open tabs receive a storage event and reload too. That event grants no access.

## Audit

CRM actions use privileged Appwrite database clients, so native Auth attribution
alone does not cover those writes. Impersonated database mutations additionally
write attempt, completion and failure metadata to the existing append-only
`lead_history` archive. The original operator ID and target ID are retained;
document bodies are not copied into these generic events. Start and explicit Stop
events are also recorded. Lead-specific history continues to record its normal
events with both identities.

No schema migration or account capability change is required by this feature.
Before production use, verify with an already authorized, native-MFA signed-in
operator that switching, target role/department scopes, revocation, Stop,
cross-tab reload and audit records work against the deployed Appwrite service.
Automated tests use mocked native account responses and cannot establish that
live service behavior.

Reference: [Appwrite user impersonation](https://appwrite.io/docs/products/auth/impersonation)
and [REST impersonation headers](https://appwrite.io/docs/apis/rest).
