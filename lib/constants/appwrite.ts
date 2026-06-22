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
};

export const BUCKETS = {
  RESUMES: process.env.NEXT_PUBLIC_APPWRITE_RESUMES_BUCKET_ID ?? 'resumes',
};
