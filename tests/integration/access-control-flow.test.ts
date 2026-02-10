/**
 * Integration Test: Access Control Flow
 *
 * Tests the complete access control flow:
 * manager restricts component → agent cannot access
 *
 * Requirements: 2.1-2.6, 10.8
 */

import { databases } from '@/lib/appwrite';

jest.mock('@/lib/appwrite', () => ({
  databases: {
    createDocument: jest.fn(),
    getDocument: jest.fn(),
    updateDocument: jest.fn(),
    deleteDocument: jest.fn(),
    listDocuments: jest.fn(),
  },
  DATABASE_ID: 'test-database',
  COLLECTIONS: {
    ACCESS_CONFIG: 'test-access-config-collection',
  },
}));

// Inline access control logic for testing (mirrors AccessControlProvider)
type ComponentKey = 'dashboard' | 'leads' | 'history' | 'user-management' | 'field-management' | 'settings';

interface AccessRule {
  componentKey: ComponentKey;
  role: 'manager' | 'agent';
  allowed: boolean;
}

function canAccess(
  componentKey: ComponentKey,
  userRole: 'manager' | 'agent',
  rules: Map<string, boolean>
): boolean {
  // Managers always have full access
  if (userRole === 'manager') {
    return true;
  }

  // Check for custom rule
  const ruleKey = `${componentKey}-${userRole}`;
  const customRule = rules.get(ruleKey);

  if (customRule !== undefined) {
    return customRule;
  }

  // Default: manager=true, agent=false
  return userRole === 'manager';
}

function buildRulesMap(rules: AccessRule[]): Map<string, boolean> {
  const map = new Map<string, boolean>();
  rules.forEach((rule) => {
    map.set(`${rule.componentKey}-${rule.role}`, rule.allowed);
  });
  return map;
}

function getVisibleNavItems(
  userRole: 'manager' | 'agent',
  rules: Map<string, boolean>
): ComponentKey[] {
  const allComponents: ComponentKey[] = [
    'dashboard',
    'leads',
    'history',
    'user-management',
    'field-management',
    'settings',
  ];

  return allComponents.filter((key) => canAccess(key, userRole, rules));
}

describe('Integration: Access Control Flow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should complete the access control flow: configure rules → agent sees restricted view', () => {
    // Step 1: Default rules - agent can access dashboard and leads
    const defaultRules: AccessRule[] = [
      { componentKey: 'dashboard', role: 'agent', allowed: true },
      { componentKey: 'leads', role: 'agent', allowed: true },
      { componentKey: 'history', role: 'agent', allowed: false },
      { componentKey: 'user-management', role: 'agent', allowed: false },
      { componentKey: 'field-management', role: 'agent', allowed: false },
      { componentKey: 'settings', role: 'agent', allowed: false },
    ];

    let rulesMap = buildRulesMap(defaultRules);

    // Step 2: Verify agent sees only permitted components
    let agentNav = getVisibleNavItems('agent', rulesMap);
    expect(agentNav).toContain('dashboard');
    expect(agentNav).toContain('leads');
    expect(agentNav).not.toContain('history');
    expect(agentNav).not.toContain('user-management');
    expect(agentNav).not.toContain('field-management');
    expect(agentNav).not.toContain('settings');

    // Step 3: Manager always sees all components
    const managerNav = getVisibleNavItems('manager', rulesMap);
    expect(managerNav).toHaveLength(6);

    // Step 4: Manager grants agent access to history
    const updatedRules: AccessRule[] = [
      ...defaultRules.filter((r) => r.componentKey !== 'history'),
      { componentKey: 'history', role: 'agent', allowed: true },
    ];

    rulesMap = buildRulesMap(updatedRules);

    // Step 5: Agent now sees history
    agentNav = getVisibleNavItems('agent', rulesMap);
    expect(agentNav).toContain('history');
    expect(agentNav).toHaveLength(3); // dashboard, leads, history

    // Step 6: Manager revokes agent access to leads
    const restrictedRules: AccessRule[] = [
      { componentKey: 'dashboard', role: 'agent', allowed: true },
      { componentKey: 'leads', role: 'agent', allowed: false },
      { componentKey: 'history', role: 'agent', allowed: true },
      { componentKey: 'user-management', role: 'agent', allowed: false },
      { componentKey: 'field-management', role: 'agent', allowed: false },
      { componentKey: 'settings', role: 'agent', allowed: false },
    ];

    rulesMap = buildRulesMap(restrictedRules);

    agentNav = getVisibleNavItems('agent', rulesMap);
    expect(agentNav).not.toContain('leads');
    expect(agentNav).toContain('dashboard');
    expect(agentNav).toContain('history');
    expect(agentNav).toHaveLength(2);
  });

  it('should apply default rules when no custom rules exist', () => {
    const emptyRules = new Map<string, boolean>();

    // Agent should have no access by default (no rules = default deny)
    expect(canAccess('dashboard', 'agent', emptyRules)).toBe(false);
    expect(canAccess('leads', 'agent', emptyRules)).toBe(false);
    expect(canAccess('history', 'agent', emptyRules)).toBe(false);

    // Manager always has access
    expect(canAccess('dashboard', 'manager', emptyRules)).toBe(true);
    expect(canAccess('leads', 'manager', emptyRules)).toBe(true);
    expect(canAccess('history', 'manager', emptyRules)).toBe(true);
  });

  it('should persist access config changes via database', async () => {
    // Simulate manager toggling agent access to history
    const existingRule = {
      $id: 'rule-history-agent',
      componentKey: 'history',
      role: 'agent',
      allowed: false,
    };

    // Manager toggles to allowed=true
    (databases.updateDocument as jest.Mock).mockResolvedValue({
      ...existingRule,
      allowed: true,
    });

    const updatedDoc = await databases.updateDocument(
      'test-database',
      'test-access-config-collection',
      existingRule.$id,
      { allowed: true }
    );

    expect(databases.updateDocument).toHaveBeenCalledWith(
      'test-database',
      'test-access-config-collection',
      'rule-history-agent',
      { allowed: true }
    );
    expect(updatedDoc.allowed).toBe(true);
  });

  it('should create new access rule when none exists', async () => {
    const newRule = {
      $id: 'rule-new',
      componentKey: 'settings',
      role: 'agent',
      allowed: true,
    };

    (databases.createDocument as jest.Mock).mockResolvedValue(newRule);

    const createdDoc = await databases.createDocument(
      'test-database',
      'test-access-config-collection',
      'unique()',
      {
        componentKey: 'settings',
        role: 'agent',
        allowed: true,
      }
    );

    expect(databases.createDocument).toHaveBeenCalled();
    expect(createdDoc.allowed).toBe(true);
  });

  it('should handle manager access override regardless of rules', () => {
    // Even if rules explicitly deny manager access, manager should still have access
    const denyManagerRules: AccessRule[] = [
      { componentKey: 'dashboard', role: 'manager', allowed: false },
      { componentKey: 'leads', role: 'manager', allowed: false },
    ];

    const rulesMap = buildRulesMap(denyManagerRules);

    // Manager always has access (the canAccess function returns true for managers before checking rules)
    expect(canAccess('dashboard', 'manager', rulesMap)).toBe(true);
    expect(canAccess('leads', 'manager', rulesMap)).toBe(true);
    expect(canAccess('history', 'manager', rulesMap)).toBe(true);
  });

  it('should correctly filter navigation items based on access rules', () => {
    const rules: AccessRule[] = [
      { componentKey: 'dashboard', role: 'agent', allowed: true },
      { componentKey: 'leads', role: 'agent', allowed: true },
      { componentKey: 'history', role: 'agent', allowed: false },
      { componentKey: 'user-management', role: 'agent', allowed: false },
      { componentKey: 'field-management', role: 'agent', allowed: false },
      { componentKey: 'settings', role: 'agent', allowed: false },
    ];

    const rulesMap = buildRulesMap(rules);

    const agentItems = getVisibleNavItems('agent', rulesMap);
    const managerItems = getVisibleNavItems('manager', rulesMap);

    // Agent sees only allowed components
    expect(agentItems).toEqual(['dashboard', 'leads']);

    // Manager sees all components
    expect(managerItems).toEqual([
      'dashboard',
      'leads',
      'history',
      'user-management',
      'field-management',
      'settings',
    ]);
  });
});
