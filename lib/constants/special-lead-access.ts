export const SPECIAL_BRANCH_LEAD_ACCESS: Record<string, string> = {
  'alisha.dsouza@silverspaceinc.com': '698baf2643ccaf6ce902',
};

export function getSpecialBranchLeadAccess(email: string | undefined | null): string | null {
  if (!email) return null;
  return SPECIAL_BRANCH_LEAD_ACCESS[email.trim().toLowerCase()] ?? null;
}
