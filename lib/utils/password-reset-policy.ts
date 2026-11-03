/** The CRM owner may set any other user's password, admins included. */
export const CRM_OWNER_EMAIL = 'abhirupvizva@gmail.com';
export const CRM_OWNER_USER_ID = '698a5e64002675ad41f6';
/** Roles an ordinary admin may set a password for directly. */
export const ADMIN_PASSWORD_RESET_ROLES = ['agent', 'team_lead'] as const;
export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 256;

type Person = { $id: string; role: string; email?: string; isActive?: boolean };

export function isCrmOwner(person: Person | null | undefined) {
  return !!person && person.$id === CRM_OWNER_USER_ID && person.role === 'admin' &&
    person.email?.trim().toLowerCase() === CRM_OWNER_EMAIL;
}

/** Shared by the users table (button visibility) and the server action (enforcement). */
export function canSetUserPassword(actor: Person | null | undefined, target: Person) {
  if (!actor || actor.isActive === false || actor.$id === target.$id) return false;
  if (isCrmOwner(actor)) return true;
  return actor.role === 'admin' && (ADMIN_PASSWORD_RESET_ROLES as readonly string[]).includes(target.role);
}
