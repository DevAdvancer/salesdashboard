# Repository Coverage Ledger

| row | area | family | source/control/sink | disposition | evidence |
| --- | --- | --- | --- | --- | --- |
| RW-001 | Server actions using admin Appwrite client | authz/IDOR/privilege escalation | Browser-supplied currentUserId/userId/actorId selected actor before admin-client calls | reportable-fixed | Fixed with assertAuthenticatedUserId in user, lead, access-settings, profile, sop, mock, interview, assessment actions. |
| RW-002 | Appwrite session helper | session confusion | Fallback selected any a_session_* cookie, not only configured project cookie | reportable-fixed | Fixed by rejecting requests without exact project/legacy/project-id cookie names. |
| RW-003 | Graph send-email routes | missing CRM auth / CSRF-adjacent privileged action | Outlook cookie alone authorized POST to Graph sendMail | reportable-fixed | Fixed by requiring Appwrite authenticated account before token use. |
| RW-004 | app/api/debug-config | sensitive config disclosure | Public GET returned endpoint/project/database/collection ids | low-fixed | Fixed by returning 404 in production. Values are NEXT_PUBLIC but route was unnecessary exposure. |
| RW-005 | Query construction | injection | Appwrite Query helpers used rather than raw query strings | suppressed | No raw SQL/eval/template query sink found in reviewed runtime surfaces. |
| RW-006 | RCE/process/file APIs | command/path/file impact | No child_process/eval/file upload/extraction sinks in runtime app files | not_applicable | Keyword pass and file review found no reachable command execution or filesystem sink. |
| RW-007 | Dependency advisories | supply chain | npm audit advisory lookup | deferred | External registry query was blocked pending explicit user approval. |
