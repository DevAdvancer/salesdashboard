import type { UserRole } from "@/lib/types";

export function isMonitorRole(role: UserRole) {
  return role === 'monitor';
}

export function isOperationsRole(role: UserRole) {
  return role === 'operations';
}

export function isAdminLikeReadAllRole(role: UserRole) {
  return ['admin', 'developer', 'monitor', 'operations'].includes(role);
}
