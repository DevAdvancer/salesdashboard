import { UserRole } from '@/lib/types';

export const BOOTSTRAP_ADMIN_EMAIL = 'abhirupvizva@gmail.com';

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function getSignupRoleForEmail(email: string): UserRole {
  return 'admin';
}
