export const LEAD_EXPORT_ACCESS_EMAILS = [
  "alisha.dsouza@silverspaceinc.com",
];

export function canExportLeadsByEmail(email?: string | null): boolean {
  if (!email) return false;

  return LEAD_EXPORT_ACCESS_EMAILS.includes(email.toLowerCase());
}
