// ─── Call-request document checklist ────────────────────────────────────────
// Static list of documents a Sales user must confirm are collected before
// raising a call request to the Resume team. Editable here — the Request Calls
// page renders one checkbox per entry, and submission is blocked until every
// item is confirmed. The confirmed snapshot is stored on the call_request
// document (documentsChecklist JSON) so the Resume team can see what was
// attested at submit time.
//
// To add / remove a required document, edit this array. `key` is a stable
// identifier persisted in the snapshot; `label` is the human-facing text.

export interface RequiredDocument {
  key: string;
  label: string;
}

export const REQUIRED_DOCUMENTS: RequiredDocument[] = [
  { key: 'resume', label: 'Updated resume' },
  { key: 'id_proof', label: 'Government ID proof' },
  { key: 'work_authorization', label: 'Work authorization / visa status' },
  { key: 'contact_details', label: 'Verified contact details (phone & email)' },
  { key: 'job_preferences', label: 'Job role & location preferences' },
];
