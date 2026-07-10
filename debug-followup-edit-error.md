[OPEN] Followup edit error

Session ID: `followup-edit-error`
Date: 2026-07-10

## Symptom
- Editing existing followup payment rows fails.
- UI shows a generic production server render/save error.
- Earlier static fixes did not resolve the issue.

## Hypotheses
1. The update payload still includes an unsupported Appwrite attribute on some environments.
2. The edited row shape differs from newer rows, and update fails only for legacy documents.
3. The server action succeeds in Appwrite but throws while mapping or returning the response.
4. The submitted date/remark payload shape causes a server-side validation or serialization failure.
5. The fallback update path is not catching the real failing attribute/message.

## Plan
- Add instrumentation only to the followups update path.
- Reproduce the failing edit flow.
- Inspect runtime evidence.
- Apply the minimal fix based on evidence.
- Verify with post-fix evidence.

## Status
- Debug session initialized.
- Instrumentation added to `app/actions/previous-followups-payments.ts`.
- Evidence collected from live Appwrite repro:
  - The row `Guru Revanth Nethi` (`6a51567400216b8568aa`) failed on any update attempt.
  - Even payloads containing only `updatedAt` failed with `Invalid document structure: Unknown attribute: "remark"`.
  - This confirmed the issue is tied to legacy followup rows carrying the old `remark` field.
- Fix applied:
  - Added a legacy-row replacement path in `updatePreviousFollowupsPaymentAction` flow.
  - Repaired 11 existing followup documents in Appwrite by recreating them without relying on `updateDocument`.
