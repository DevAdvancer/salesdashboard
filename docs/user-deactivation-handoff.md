# Inactivation and lead handoff

In **Users**, choose **Inactivate**, select an active Sales recipient (including yourself), review the open/closed lead and LinkedIn totals, then confirm.

- Both `ownerId` and `assignedToId` move to the recipient for every lead owned by or assigned to the departing user, including closed leads. Lead IDs, branch, status, closure dates and payment data stay intact.
- The original `creatorId` is retained. Missing creator metadata is recovered from creation history where available. Legacy records without creation evidence are labelled **Original recorded owner**, rather than presented as a verified creator.
- Active sent/accepted CRM requests are marked withdrawn for the departing user and across every assigned LinkedIn account, including requests originally sent by somebody else. Assigned accounts are disabled. This does not call LinkedIn to withdraw invitations on its website.
- Lead History records the initiating actor, previous owner/assignee, recipient and time. Handoffs use names and plain descriptions. Creation and previous archive events remain available for open and closed leads; attempt records remain in the archive but are hidden in the normal history display.

## Access and execution

The existing inactivation roles remain unchanged: admins/developers can manage eligible users; TLs can manage their own same-department team; Senior TLs can manage their department. Sales handoff recipients must be active Sales agents, TLs, Senior TLs, admins or developers. TL recipients are limited to themselves and their own team. Resume users cannot receive Sales leads.

Preview and apply both authorize on the server. Apply rejects stale previews. Login is disabled before processing withdrawals and leads. Leads are handed over in batches of ten, and the dialog automatically continues with the same recipient and fresh previews. Keep the dialog open until it finishes.

If a batch fails or the page closes, open **Inactive users → Complete handoff** to review and finish the remaining work. Completed transfers are skipped; their history is retained. A stale/conflicting lead or an inactive recipient fails closed.

No schema migration or existing-data backfill is required. The workflow uses the existing `lead_history`, `leads.history` (when enabled), lead JSON and server-only `linkedin_lead_registry` lock infrastructure. A hard process termination can leave the existing distributed locks behind; an administrator must inspect the affected operation before recovering its lock. Do not remove unrelated profile locks.
