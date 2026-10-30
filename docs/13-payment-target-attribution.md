# Payment history and target attribution

Target revenue uses dated financial events, independently of the lead's current
status, close date, or the payment document's last edit date. The target summary,
profile breakdown, and scheduled email share `targetUpfrontAmounts`.

- Client payment updates count in their business date window. Explicit
  `paymentDate` values stay literal; timestamp-only events use Eastern time.
- Followups and refunds use the saved `date`, including backdated entries.
  A refund reduces achievement and never increases upfront revenue.
- A history update with `sourceFollowupId` is a mirror. Its source followup
  counts once; the mirror does not count again as upfront revenue. Older mirrors
  can be recognized by matching their amount, timestamp, and followup note.
- All financial categories use the selected target's configured date window,
  or the calendar month when no custom window exists.
- New followups save their credited profile separately from the creator. The
  creator remains the actual signed-in actor. Historical rows without explicit
  credit use the assigned agent, then the lead owner. The recording admin never
  overrides that assignment. Independent entries use their saved credit or creator.
- Read all source followups when identifying older mirrors, even when their
  business date falls outside the selected report month. Only source entries in
  the selected date window contribute to that month's followup total.
- Payment History shows the credited profile separately from "Updated by".
  Unambiguous older mirrors appear once with the followup's business date and
  credit, while retaining the payment update's actual audit actor. No historical
  database records are rewritten to achieve this display.
- Some legacy edits appended the full followup amount again without a source
  link. Unambiguous creation/edit timestamps (including a documented legacy
  document recreation) identify these snapshots. Reads derive signed adjustments
  from them, retain the stored amount as `recordedAmount`, and preserve the actor.
  An unchanged $500 receipt followed by a $500 edit contributes $500, not $1,000;
  the edit appears as "Follow-up details updated". Financial summaries, history,
  reports, and targets use the same interpretation. Ambiguous entries remain
  untouched. No database repair is performed during reads.
- Saving an older followup reconciles its existing history before calculating
  the delta. Date/remark-only changes do not append another full receipt, and a
  change from $500 to $700 appends only $200. The form prevents overlapping saves.
- Followup history has no implicit 30-day cutoff. Explicit date filters and
  actor/team visibility still apply. Client selection includes accessible
  historical payment clients even after their lead is reopened or backed out.
- Manually typed entries count without a lead or client payment record. Revenue
  remains visible when a credited profile has no monthly target assignment;
  historical inactive profiles are included within the viewer's existing scope.
- Legacy manual entries with no recorded profile appear in a leadership-only
  "Unassigned manual follow-ups" row and drilldown. They are never guessed onto
  the recording user's profile. They contribute revenue but do not invent a target
  or increase the report's actual profile count.

## Independent BGC

Choose **BGC** in Add Followup Payment, enter the candidate and company, select
the credited profile where available, and save the amount and payment date.
Refunds work like other followup refunds. BGC is included in achieved and is
also shown separately in the profile's target breakdown.

BGC entries use `manual_followup:bgc:<id>` in the existing `leadId` field. This
is a reserved independent identifier, never an Appwrite lead document. Category
is derived from that prefix, so no schema migration is required. Editing keeps
the identifier stable. BGC does not read, create, or modify a lead or a client
payment record.
