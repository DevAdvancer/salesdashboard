export const DATABASE_ID = process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID ?? 'crm-database-1';

export const COLLECTIONS = {
  USERS: process.env.NEXT_PUBLIC_APPWRITE_USERS_COLLECTION_ID ?? 'users',
  LEADS: process.env.NEXT_PUBLIC_APPWRITE_LEADS_COLLECTION_ID ?? 'leads',
  FORM_CONFIG: process.env.NEXT_PUBLIC_APPWRITE_FORM_CONFIG_COLLECTION_ID ?? 'form_config',
  ACCESS_CONFIG: process.env.NEXT_PUBLIC_APPWRITE_ACCESS_CONFIG_COLLECTION_ID ?? 'access_config',
  BRANCHES: process.env.NEXT_PUBLIC_APPWRITE_BRANCHES_COLLECTION_ID ?? 'branches',
  MOCK_ATTEMPTS: process.env.NEXT_PUBLIC_APPWRITE_MOCK_ATTEMPTS_COLLECTION_ID ?? 'mock_attempts',
  ASSESSMENT_ATTEMPTS: process.env.NEXT_PUBLIC_APPWRITE_ASSESSMENT_ATTEMPTS_COLLECTION_ID ?? 'assessment_attempts',
  INTERVIEW_ATTEMPTS: process.env.NEXT_PUBLIC_APPWRITE_INTERVIEW_ATTEMPTS_COLLECTION_ID ?? 'interview_attempts',
  AUDIT_LOGS: process.env.NEXT_PUBLIC_APPWRITE_AUDIT_LOGS_COLLECTION_ID ?? 'audit_logs',
  LEAD_NOTES: process.env.NEXT_PUBLIC_APPWRITE_LEAD_NOTES_COLLECTION_ID ?? 'lead_notes',
  COACHING_NOTES: process.env.NEXT_PUBLIC_APPWRITE_COACHING_NOTES_COLLECTION_ID ?? 'coaching_notes',
  REVIEW_QUEUE: process.env.NEXT_PUBLIC_APPWRITE_REVIEW_QUEUE_COLLECTION_ID ?? 'review_queue',
  NOTIFICATIONS: process.env.NEXT_PUBLIC_APPWRITE_NOTIFICATIONS_COLLECTION_ID ?? 'notifications',
  ATTENDANCE: process.env.NEXT_PUBLIC_APPWRITE_ATTENDANCE_COLLECTION_ID ?? 'attendance',
  CHAT_MESSAGES: process.env.NEXT_PUBLIC_APPWRITE_CHAT_MESSAGES_COLLECTION_ID ?? 'chat_messages',
  // Dedicated store for the Resume team's chat, kept separate from the Sales
  // `chat_messages` table. Same document shape (channel/body/author/createdAt)
  // and same channels (announcement / general); the department column is still
  // written for parity but every row here is a resume-team message.
  RESUME_CHAT_MESSAGES: process.env.NEXT_PUBLIC_APPWRITE_RESUME_CHAT_MESSAGES_COLLECTION_ID ?? 'resume_chat_messages',
  CLIENT_PAYMENTS: process.env.NEXT_PUBLIC_APPWRITE_CLIENT_PAYMENTS_COLLECTION_ID ?? 'client_payments',
  LEAD_REQUESTS: process.env.NEXT_PUBLIC_APPWRITE_LEAD_REQUESTS_COLLECTION_ID ?? 'lead_requests',
  LINKEDIN_ACCOUNTS: process.env.NEXT_PUBLIC_APPWRITE_LINKEDIN_ACCOUNTS_COLLECTION_ID ?? 'linkedin_accounts',
  LINKEDIN_REQUESTS: process.env.NEXT_PUBLIC_APPWRITE_LINKEDIN_REQUESTS_COLLECTION_ID ?? 'linkedin_requests',
  // One document per Lead Gen → Team Lead handoff. Written at lead-
  // creation time when a lead_generation actor hands a lead to a TL,
  // never updated. The "Lead Gen Team Handoffs" dashboard count is
  // derived from this table grouped by `teamLeadId`. See
  // app/actions/lg-handoffs.ts.
  LG_HANDOFFS: process.env.NEXT_PUBLIC_APPWRITE_LG_HANDOFFS_COLLECTION_ID ?? 'lg_handoffs',
  // One document per "Not Interested" marking event. A new `active`
  // row is written every time an agent marks a lead not-interested;
  // the prior `active` row for that lead is flipped to `reopened` in
  // the same flow. Reports count only `status: "active"` rows in the
  // selected date range, attributed to the agent who previously owned
  // the lead. See lib/actions/lead-actions.ts:notInterestedLeadAction
  // and the Weekly Report action.
  NOT_INTERESTED_LEADS: process.env.NEXT_PUBLIC_APPWRITE_NOT_INTERESTED_LEADS_COLLECTION_ID ?? 'not_interested_leads',
  // One document per (team_lead_id, month_key) carrying the team's
  // monthly target set by an admin. Powers the new Target-Report page.
  MONTHLY_TARGETS: process.env.NEXT_PUBLIC_APPWRITE_MONTHLY_TARGETS_COLLECTION_ID ?? 'monthly_targets',
  // One document per (monthly_target_id, agent_id) carrying the per-agent
  // split amount chosen by the TL within their team's monthly target.
  MONTHLY_TARGET_ASSIGNMENTS: process.env.NEXT_PUBLIC_APPWRITE_MONTHLY_TARGET_ASSIGNMENTS_COLLECTION_ID ?? 'monthly_target_assignments',
  TECHNICAL_PAYMENTS: process.env.NEXT_PUBLIC_APPWRITE_TECHNICAL_PAYMENTS_COLLECTION_ID ?? 'technical_payments',
  // One doc per (lead, month) tracking the remaining balance on a client
  // payment record. Written when an operator adds a payment update with a
  // pending amount; cleared when the balance reaches zero.
  PENDING_AMOUNTS: process.env.NEXT_PUBLIC_APPWRITE_PENDING_AMOUNTS_COLLECTION_ID ?? 'pending_amounts',
  // One doc per followup payment entry to track manual followup payments.
  PREVIOUS_FOLLOWUPS_PAYMENTS: process.env.NEXT_PUBLIC_APPWRITE_PREVIOUS_FOLLOWUPS_PAYMENTS_COLLECTION_ID ?? 'previous_followups_payments',
  // One doc per holiday date used to exclude weekday holidays from KPI math.
  HOLIDAY_CALENDAR: process.env.NEXT_PUBLIC_APPWRITE_HOLIDAY_CALENDAR_COLLECTION_ID ?? 'holiday_calendar',
  // One doc per Sales → Resume "call request". Carries the request status
  // (not_called → pending_documents → call_done), the assigned Resume user,
  // a snapshot of the document checklist confirmed at submit time, and the
  // per-request chat stored as a JSON array (each message tagged with the
  // sender's team). See app/actions/call-requests.ts.
  CALL_REQUESTS: process.env.NEXT_PUBLIC_APPWRITE_CALL_REQUESTS_COLLECTION_ID ?? 'call_requests',
  RESUME_PROFILES: process.env.NEXT_PUBLIC_APPWRITE_RESUME_PROFILES_COLLECTION_ID ?? 'resume_profiles',
};

export const BUCKETS = {
  RESUMES: process.env.NEXT_PUBLIC_APPWRITE_RESUMES_BUCKET_ID ?? 'resumes',
};
