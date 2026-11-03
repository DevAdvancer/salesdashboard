export const CRM_IMPERSONATION_COOKIE = 'crm_impersonate_user';
export const APPWRITE_IMPERSONATION_HEADER = 'X-Appwrite-Impersonate-User-Id';
export const validImpersonationId = (id: string) => /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,35}$/.test(id);
export function hasImpersonationCapability(account: { impersonator?: unknown; status?: boolean; impersonatorUserId?: string }) {
  return account.impersonator === true && account.status !== false && !account.impersonatorUserId;
}
