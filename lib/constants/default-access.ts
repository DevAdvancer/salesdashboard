export type ComponentKey =
  | 'dashboard'
  | 'leads'
  | 'history'
  | 'user-management'
  | 'field-management'
  | 'settings'
  | 'branch-management';

export type UserRole = 'admin' | 'manager' | 'team_lead' | 'agent';

export interface AccessRule {
  componentKey: ComponentKey;
  role: UserRole;
  allowed: boolean;
}

export const DEFAULT_ACCESS_RULES: AccessRule[] = [
  // Admin rules — all allowed
  { componentKey: 'dashboard', role: 'admin', allowed: true },
  { componentKey: 'leads', role: 'admin', allowed: true },
  { componentKey: 'history', role: 'admin', allowed: true },
  { componentKey: 'user-management', role: 'admin', allowed: true },
  { componentKey: 'field-management', role: 'admin', allowed: true },
  { componentKey: 'settings', role: 'admin', allowed: true },
  { componentKey: 'branch-management', role: 'admin', allowed: true },
  // Manager rules
  { componentKey: 'dashboard', role: 'manager', allowed: true },
  { componentKey: 'leads', role: 'manager', allowed: true },
  { componentKey: 'history', role: 'manager', allowed: true },
  { componentKey: 'user-management', role: 'manager', allowed: true },
  { componentKey: 'field-management', role: 'manager', allowed: true },
  { componentKey: 'settings', role: 'manager', allowed: true },
  { componentKey: 'branch-management', role: 'manager', allowed: false },
  // Team Lead rules
  { componentKey: 'dashboard', role: 'team_lead', allowed: true },
  { componentKey: 'leads', role: 'team_lead', allowed: true },
  { componentKey: 'history', role: 'team_lead', allowed: true },
  { componentKey: 'user-management', role: 'team_lead', allowed: true },
  { componentKey: 'field-management', role: 'team_lead', allowed: false },
  { componentKey: 'settings', role: 'team_lead', allowed: false },
  { componentKey: 'branch-management', role: 'team_lead', allowed: false },
  // Agent rules
  { componentKey: 'dashboard', role: 'agent', allowed: true },
  { componentKey: 'leads', role: 'agent', allowed: true },
  { componentKey: 'history', role: 'agent', allowed: false },
  { componentKey: 'user-management', role: 'agent', allowed: false },
  { componentKey: 'field-management', role: 'agent', allowed: false },
  { componentKey: 'settings', role: 'agent', allowed: false },
  { componentKey: 'branch-management', role: 'agent', allowed: false },
];
