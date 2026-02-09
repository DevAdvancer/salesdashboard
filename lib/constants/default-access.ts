export type ComponentKey =
  | 'dashboard'
  | 'leads'
  | 'history'
  | 'user-management'
  | 'field-management'
  | 'settings';

export type UserRole = 'manager' | 'agent';

export interface AccessRule {
  componentKey: ComponentKey;
  role: UserRole;
  allowed: boolean;
}

export const DEFAULT_ACCESS_RULES: AccessRule[] = [
  { componentKey: 'dashboard', role: 'agent', allowed: true },
  { componentKey: 'leads', role: 'agent', allowed: true },
  { componentKey: 'history', role: 'agent', allowed: false },
  { componentKey: 'user-management', role: 'agent', allowed: false },
  { componentKey: 'field-management', role: 'agent', allowed: false },
  { componentKey: 'settings', role: 'agent', allowed: false },
];
