# Validation Report

Rubric: attacker controls the claimed input; input reaches privileged sink; existing guard fails to bind session principal; fix rejects mismatch; validation evidence is local and build/test backed.

| ledger row | instance key | root-control file:line | entrypoint/source | sink/control | disposition | counterevidence or proof gap | survives |
| --- | --- | --- | --- | --- | --- | --- | --- |
| RW-001 | authz:app/actions/user.ts:79 | lib/server/current-user.ts:10 | currentUserId/userId/actorId from server action arguments | createAdminClient users/databases calls | reportable-fixed | Production build passes after fix; focused test proves mismatched IDs reject. | yes |
| RW-002 | session:lib/server/appwrite.ts:25 | lib/server/appwrite.ts:25 | request cookies | client.setSession | reportable-fixed | Exact project cookie names still accepted; broad a_session_* fallback removed. | yes |
| RW-003 | email:app/api/mock/send-email/route.ts:7 | app/api/mock/send-email/route.ts:7 | POST route with Outlook cookie | Graph me/sendMail | reportable-fixed | Appwrite account.get now required before token use. Sibling routes patched. | yes |
| RW-004 | info:app/api/debug-config/route.ts:4 | app/api/debug-config/route.ts:4 | unauthenticated GET | environment config JSON | low-fixed | NEXT_PUBLIC values limit severity; production route now returns 404. | yes |
| RW-005 | query:appwrite | n/a | Appwrite Query helpers | Appwrite listDocuments | suppressed | No raw query language sink found. | no |
| RW-006 | rce-file | n/a | runtime app routes/actions | command/filesystem sinks | not_applicable | No reachable sink found in reviewed files. | no |
| RW-007 | dependency-audit | package-lock.json | dependency inventory | npm registry advisories | deferred | External audit query blocked pending explicit approval. | uncertain |

Validation commands:
- npm test -- tests/unit/security/current-user.test.ts --runInBand: passed, 3 tests.
- npm run build: passed after approved network access for Google Fonts.
- npm test -- --runInBand: failed in pre-existing unrelated tests; no failure attributed to the new current-user helper.
- npx tsc --noEmit: failed in pre-existing test typing issues; production build TypeScript passed.
- npm run lint: failed due widespread pre-existing lint errors, including existing any usage in touched files.
