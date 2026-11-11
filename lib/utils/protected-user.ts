export const CRM_OWNER_EMAIL = 'abhirupvizva@gmail.com';
export const CRM_OWNER_USER_ID = '698a5e64002675ad41f6';

export function isProtectedUserFromDeletion(user: { $id: string; email?: string | null }) {
  return user.$id === CRM_OWNER_USER_ID || user.email?.trim().toLowerCase() === CRM_OWNER_EMAIL;
}
