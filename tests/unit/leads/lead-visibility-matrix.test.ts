export {};

// `app/actions/lead.ts` reads its database and collection ids from
// process.env at module scope (see its top-of-file consts), so these must be
// set before the module is required or every listDocuments call receives an
// undefined collection id.
process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID = 'test-database';
process.env.NEXT_PUBLIC_APPWRITE_LEADS_COLLECTION_ID = 'test-leads-collection';
process.env.NEXT_PUBLIC_APPWRITE_USERS_COLLECTION_ID = 'test-users-collection';

/**
 * Lead visibility matrix: regression lock.
 *
 * Guards the visibility scope that `listLeadsAction` applies per role. This is
 * the contract that must NOT move when the `leads` / `users` collection
 * permissions are changed from `read("any")` to `read("users")`.
 *
 * Why this test exists: that permission change is made in the Appwrite console,
 * not in code, so no hermetic test can observe it directly. What this test CAN
 * do is pin the application-side visibility semantics, so that if anyone later
 * "fixes" visibility in code to compensate for a permission change, the drift
 * fails here instead of silently changing what users see.
 *
 * The live half of the gate is `scripts/verify-lead-visibility-parity.ts`,
 * which diffs owned/assigned/app/doc counts against
 * `tests/fixtures/lead-visibility-baseline.json` before and after the change.
 *
 * These tests drive the REAL action. The Appwrite mock below evaluates the
 * query descriptors that the action builds, so a change to the query-building
 * logic changes the result set here.
 */

// ---------------------------------------------------------------------------
// Query descriptors + evaluator
// ---------------------------------------------------------------------------

type Desc =
  | { t: 'equal' | 'notEqual' | 'gte' | 'lte'; k: string; v: unknown }
  | { t: 'or' | 'and'; conds: Desc[] }
  | { t: 'isNull'; k: string }
  | { t: 'orderAsc' | 'orderDesc'; k: string }
  | { t: 'limit' | 'offset'; n: number }
  | { t: 'cursorAfter'; id: string }
  | { t: 'select'; fields: string[] };

const asArray = (v: unknown) => (Array.isArray(v) ? v : [v]);

function matches(doc: Record<string, any>, d: Desc): boolean {
  switch (d.t) {
    case 'equal':
      return asArray(d.v).some((x) => doc[d.k] === x);
    case 'notEqual':
      return !asArray(d.v).some((x) => doc[d.k] === x);
    case 'gte':
      return String(doc[d.k] ?? '') >= String(d.v);
    case 'lte':
      return String(doc[d.k] ?? '') <= String(d.v);
    case 'isNull':
      return doc[d.k] === null || doc[d.k] === undefined;
    case 'or':
      return d.conds.some((c) => matches(doc, c));
    case 'and':
      return d.conds.every((c) => matches(doc, c));
    default:
      return true; // ordering / paging / projection are not filters
  }
}

function evaluate(collection: Record<string, any>[], queries: Desc[]) {
  const filters = queries.filter((q) =>
    ['equal', 'notEqual', 'gte', 'lte', 'or', 'and', 'isNull'].includes(q.t)
  );
  let rows = collection.filter((doc) => filters.every((f) => matches(doc, f)));

  const order = queries.find((q) => q.t === 'orderAsc' || q.t === 'orderDesc') as
    | { t: 'orderAsc' | 'orderDesc'; k: string }
    | undefined;
  if (order) {
    rows = [...rows].sort((a, b) => {
      const av = String(a[order.k] ?? '');
      const bv = String(b[order.k] ?? '');
      return order.t === 'orderAsc' ? av.localeCompare(bv) : bv.localeCompare(av);
    });
  }

  const total = rows.length;

  const cursor = queries.find((q) => q.t === 'cursorAfter') as { id: string } | undefined;
  if (cursor) {
    const idx = rows.findIndex((r) => r.$id === cursor.id);
    rows = idx >= 0 ? rows.slice(idx + 1) : rows;
  }
  const offset = queries.find((q) => q.t === 'offset') as { n: number } | undefined;
  if (offset) rows = rows.slice(offset.n);
  const limit = queries.find((q) => q.t === 'limit') as { n: number } | undefined;
  if (limit) rows = rows.slice(0, limit.n);

  return { documents: rows, total };
}

// ---------------------------------------------------------------------------
// Fixture: mirrors the production shape, including its edge cases
// ---------------------------------------------------------------------------

const ADMIN = 'u-admin';
const MONITOR = 'u-monitor';
const OPERATIONS = 'u-ops';
const TL_A = 'u-tl-a';
const TL_B = 'u-tl-b';
const AGENT_A1 = 'u-agent-a1';
const AGENT_A2 = 'u-agent-a2';
const AGENT_B1 = 'u-agent-b1';
const LG_A = 'u-lg-a';
const RESUME_AGENT = 'u-resume-agent';
const DELETED = 'u-deleted-ghost'; // owns leads but has no user document

const USERS: Record<string, any>[] = [
  { $id: ADMIN, name: 'Admin', role: 'admin', department: 'sales', isActive: true },
  { $id: MONITOR, name: 'Monitor', role: 'monitor', department: 'sales', isActive: true },
  { $id: OPERATIONS, name: 'Ops', role: 'operations', department: 'sales', isActive: true },
  { $id: TL_A, name: 'TL A', role: 'team_lead', department: 'sales', isActive: true },
  { $id: TL_B, name: 'TL B', role: 'team_lead', department: 'sales', isActive: true },
  { $id: AGENT_A1, name: 'Agent A1', role: 'agent', department: 'sales', isActive: true, teamLeadId: TL_A },
  { $id: AGENT_A2, name: 'Agent A2', role: 'agent', department: 'sales', isActive: false, teamLeadId: TL_A },
  { $id: AGENT_B1, name: 'Agent B1', role: 'agent', department: 'sales', isActive: true, teamLeadId: TL_B },
  { $id: LG_A, name: 'LG A', role: 'lead_generation', department: 'sales', isActive: true, teamLeadId: TL_A },
  { $id: RESUME_AGENT, name: 'Resume Agent', role: 'agent', department: 'resume', isActive: true },
];

const SALES_USER_IDS = new Set(
  USERS.filter((u) => u.department === 'sales').map((u) => u.$id)
);

let seq = 0;
function lead(owner: string, assigned: string | null, extra: Record<string, any> = {}) {
  seq += 1;
  return {
    $id: `lead-${String(seq).padStart(3, '0')}`,
    $createdAt: `2026-07-${String(seq).padStart(2, '0')}T00:00:00.000Z`,
    ownerId: owner,
    assignedToId: assigned,
    branchId: 'branch-1',
    status: 'New',
    isClosed: false,
    data: JSON.stringify({ firstName: 'T', lastName: String(seq) }),
    ...extra,
  };
}

const LEADS: Record<string, any>[] = [
  lead(AGENT_A1, AGENT_A1), // 1  owned+assigned to A1
  lead(AGENT_A1, null), //     2  owned by A1, unassigned
  lead(AGENT_A2, AGENT_A2), // 3  deactivated agent still owns
  lead(AGENT_B1, AGENT_B1), // 4  other team
  lead(LG_A, AGENT_A1), //     5  created by lead-gen, worked by A1
  lead(LG_A, null), //         6  lead-gen owned, unassigned
  lead(TL_A, TL_A), //         7  team lead's own
  lead(AGENT_A1, AGENT_B1), // 8  owned team A, assigned team B
  lead(RESUME_AGENT, null), // 9  resume-owned: outside the sales department scope
  lead(DELETED, null), //     10  orphan: owner has no user document
  // 11: closed + backed out, in a branch nobody on team A belongs to. Used to
  // pin the caller-supplied `branchIds` widening described below.
  lead(AGENT_B1, AGENT_B1, {
    branchId: 'branch-2',
    isClosed: true,
    status: 'Backed Out',
  }),
];

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockAssertAuthenticatedUserId = jest.fn();

jest.mock('@/lib/server/current-user', () => ({
  assertAuthenticatedUserId: (...a: unknown[]) => mockAssertAuthenticatedUserId(...a),
  getAuthenticatedAccount: jest.fn(),
  getAuthenticatedUserDoc: jest.fn(),
}));

jest.mock('@/lib/server/department-user-cache', () => ({
  getDepartmentScopedUserIds: jest.fn(async () => SALES_USER_IDS),
  invalidateDepartmentScopedUserIds: jest.fn(),
}));

jest.mock('@/lib/constants/special-lead-access', () => ({
  getSpecialBranchLeadAccess: jest.fn(() => null),
}));

jest.mock('@/lib/server/notifications', () => ({
  createNotificationsForRecipients: jest.fn(),
}));

jest.mock('@/lib/services/audit-service', () => ({ logAction: jest.fn() }));

jest.mock('@/lib/server/holiday-calendar', () => ({
  listHolidayDateKeys: jest.fn(async () => []),
}));

jest.mock('@/app/actions/lg-handoffs', () => ({ recordLgHandoffAction: jest.fn() }));
jest.mock('@/app/actions/lead-duplicates', () => ({
  notifyDuplicateLeadUpdateAttemptAction: jest.fn(),
}));
jest.mock('@/lib/actions/lead-actions', () => ({
  markPriorNotInterestedRowsReopened: jest.fn(),
  notInterestedLeadAction: jest.fn(),
}));

jest.mock('node-appwrite', () => ({
  ID: { unique: jest.fn(() => 'unique-id') },
  Permission: {
    read: jest.fn((r: string) => `read(${r})`),
    update: jest.fn((r: string) => `update(${r})`),
    delete: jest.fn((r: string) => `delete(${r})`),
  },
  Role: { user: jest.fn((u: string) => `user:${u}`), label: jest.fn((l: string) => `label:${l}`) },
  Query: {
    equal: (k: string, v: unknown) => ({ t: 'equal', k, v }),
    notEqual: (k: string, v: unknown) => ({ t: 'notEqual', k, v }),
    greaterThanEqual: (k: string, v: unknown) => ({ t: 'gte', k, v }),
    lessThanEqual: (k: string, v: unknown) => ({ t: 'lte', k, v }),
    or: (conds: unknown[]) => ({ t: 'or', conds }),
    and: (conds: unknown[]) => ({ t: 'and', conds }),
    isNull: (k: string) => ({ t: 'isNull', k }),
    orderAsc: (k: string) => ({ t: 'orderAsc', k }),
    orderDesc: (k: string) => ({ t: 'orderDesc', k }),
    limit: (n: number) => ({ t: 'limit', n }),
    offset: (n: number) => ({ t: 'offset', n }),
    cursorAfter: (id: string) => ({ t: 'cursorAfter', id }),
    select: (fields: string[]) => ({ t: 'select', fields }),
    contains: (k: string, v: unknown) => ({ t: 'equal', k, v }),
  },
}));

const mockGetDocument = jest.fn(async (_db: string, collection: string, id: string) => {
  if (collection.includes('user')) {
    const u = USERS.find((x) => x.$id === id);
    if (!u) throw new Error('User not found');
    return u;
  }
  const l = LEADS.find((x) => x.$id === id);
  if (!l) throw new Error('Lead not found');
  return l;
});

const mockListDocuments = jest.fn(async (_db: string, collection: string, queries: Desc[] = []) => {
  if (!collection) throw new Error('listDocuments called with an undefined collection id');
  const source = collection.includes('user') ? USERS : LEADS;
  return evaluate(source, queries);
});

jest.mock('@/lib/server/appwrite', () => ({
  createAdminClient: async () => ({
    databases: { getDocument: mockGetDocument, listDocuments: mockListDocuments },
  }),
  createSessionClient: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { listLeadsAction, listLeadCountsAction } = require('@/app/actions/lead');

async function visibleIdsFor(userId: string) {
  const user = USERS.find((u) => u.$id === userId)!;
  const res = await listLeadsAction({}, userId, user.role, [], { forExport: true });
  return res.leads.map((l: any) => l.$id).sort();
}

// ---------------------------------------------------------------------------

describe('lead visibility matrix (must not change when collection permissions change)', () => {
  beforeEach(() => {
    mockAssertAuthenticatedUserId.mockReset();
    mockAssertAuthenticatedUserId.mockResolvedValue({ $id: 'ok' });
  });

  it('agent sees leads they own or are assigned, and nothing else', async () => {
    // owns 1, 2, 8; assigned 1, 5
    expect(await visibleIdsFor(AGENT_A1)).toEqual([
      'lead-001',
      'lead-002',
      'lead-005',
      'lead-008',
    ]);
  });

  it('agent on another team sees only their own scope', async () => {
    // owns 4, assigned 4 and 8
    expect(await visibleIdsFor(AGENT_B1)).toEqual(['lead-004', 'lead-008']);
  });

  it('lead_generation sees only leads they own, never ones assigned away', async () => {
    // owns 5 and 6; lead-005 is assigned to A1 but still owned by LG_A
    expect(await visibleIdsFor(LG_A)).toEqual(['lead-005', 'lead-006']);
  });

  it('team_lead sees their own leads plus their agents, including deactivated agents', async () => {
    // own: 7. agents A1 (1,2,8) and A2 (3). LG_A owns 5,6 -> visible by
    // assignment only: 5 is assigned to A1 so it qualifies, 6 is not.
    expect(await visibleIdsFor(TL_A)).toEqual([
      'lead-001',
      'lead-002',
      'lead-003',
      'lead-005',
      'lead-007',
      'lead-008',
    ]);
  });

  it('team_lead does not see another team lead\'s agents', async () => {
    const ids = await visibleIdsFor(TL_B);
    expect(ids).toContain('lead-004');
    expect(ids).not.toContain('lead-003');
    expect(ids).not.toContain('lead-007');
  });

  it.each([
    ['admin', ADMIN],
    ['monitor', MONITOR],
    ['operations', OPERATIONS],
  ])('%s sees every sales-department lead and nothing outside it', async (_role, id) => {
    const ids = await visibleIdsFor(id);
    // 1-8 are sales-scoped. 9 is resume-owned, 10 is owned by a deleted user.
    expect(ids).toEqual([
      'lead-001',
      'lead-002',
      'lead-003',
      'lead-004',
      'lead-005',
      'lead-006',
      'lead-007',
      'lead-008',
    ]);
    expect(ids).not.toContain('lead-009');
    expect(ids).not.toContain('lead-010');
  });

  it('leads owned by a deleted user are visible to nobody', async () => {
    for (const u of USERS.filter((x) => x.department === 'sales')) {
      const res = await listLeadsAction({}, u.$id, u.role, [], { forExport: true });
      expect(res.leads.map((l: any) => l.$id)).not.toContain('lead-010');
    }
  });

  it('resume-department non-admin users are denied the sales CRM entirely', async () => {
    await expect(
      listLeadsAction({}, RESUME_AGENT, 'agent', [], { forExport: true })
    ).rejects.toThrow(/Resume users cannot access the Sales CRM/i);
  });

  it('an unauthenticated caller is rejected before any visibility is computed', async () => {
    mockAssertAuthenticatedUserId.mockRejectedValueOnce(new Error('Unauthorized'));
    await expect(
      listLeadsAction({}, AGENT_A1, 'agent', [], { forExport: true })
    ).rejects.toThrow(/Unauthorized/i);
  });

  it('the caller-supplied role cannot widen visibility beyond the stored role', async () => {
    // Regression guard for /api/leads/list, which forwards a client-supplied
    // role straight into this action. The action must scope by the role on the
    // stored user document (app/actions/lead.ts:1370), never the argument.
    const res = await listLeadsAction({}, AGENT_A1, 'admin', [], { forExport: true });
    const ids = res.leads.map((l: any) => l.$id).sort();
    expect(ids).toEqual(['lead-001', 'lead-002', 'lead-005', 'lead-008']);
  });

  it('caller-supplied branchIds widens a team lead to backed-out leads outside their team', async () => {
    // Documents current behaviour, it is not an endorsement of it.
    // appendTeamLeadLeadVisibilityQuery adds an OR branch for
    // (branchId = branchIds[0] AND isClosed AND status in Backout...),
    // and branchIds arrives from the request body via /api/leads/list.
    // lead-011 belongs to team B in branch-2; TL A is on neither.
    const withoutBranch = await listLeadsAction(
      { isClosed: true },
      TL_A,
      'team_lead',
      [],
      { forExport: true }
    );
    expect(withoutBranch.leads.map((l: any) => l.$id)).not.toContain('lead-011');

    const withBranch = await listLeadsAction(
      { isClosed: true },
      TL_A,
      'team_lead',
      ['branch-2'],
      { forExport: true }
    );
    expect(withBranch.leads.map((l: any) => l.$id)).toContain('lead-011');
  });

  it('caller-supplied branchIds does not widen an agent', async () => {
    const res = await listLeadsAction({ isClosed: true }, AGENT_A1, 'agent', ['branch-2'], {
      forExport: true,
    });
    expect(res.leads.map((l: any) => l.$id)).not.toContain('lead-011');
  });
});

describe('LEADS_DEPT_SCOPE_INLINE expresses the department scope as a query', () => {
  // The flag swaps the admin-like department scope from "walk the whole
  // collection, then filter with leadMatchesDepartmentScope" to an
  // OR(ownerId in sales, assignedToId in sales) query on the paginated
  // listDocuments call. It is a pure refactor of HOW the scope is expressed,
  // so every role must see exactly the same rows either way.
  const ADMIN_LIKE: [string, string][] = [
    ['admin', ADMIN],
    ['monitor', MONITOR],
    ['operations', OPERATIONS],
  ];

  const previousFlag = process.env.LEADS_DEPT_SCOPE_INLINE;

  beforeEach(() => {
    mockAssertAuthenticatedUserId.mockReset();
    mockAssertAuthenticatedUserId.mockResolvedValue({ $id: 'ok' });
    delete process.env.LEADS_DEPT_SCOPE_INLINE;
  });

  afterEach(() => {
    if (previousFlag === undefined) {
      delete process.env.LEADS_DEPT_SCOPE_INLINE;
    } else {
      process.env.LEADS_DEPT_SCOPE_INLINE = previousFlag;
    }
  });

  async function bothWays<T>(run: () => Promise<T>): Promise<{ off: T; on: T }> {
    delete process.env.LEADS_DEPT_SCOPE_INLINE;
    const off = await run();
    process.env.LEADS_DEPT_SCOPE_INLINE = 'true';
    const on = await run();
    return { off, on };
  }

  it.each(ADMIN_LIKE)(
    '%s gets identical paginated leads with the flag on and off',
    async (role, id) => {
      const { off, on } = await bothWays(() =>
        listLeadsAction({}, id, role, [], { page: 1, pageSize: 100 })
      );
      expect(on.total).toBe(off.total);
      expect(on.leads.map((l: any) => l.$id)).toEqual(off.leads.map((l: any) => l.$id));
      // Guard against both sides being trivially empty.
      expect(off.leads.map((l: any) => l.$id).sort()).toEqual([
        'lead-001',
        'lead-002',
        'lead-003',
        'lead-004',
        'lead-005',
        'lead-006',
        'lead-007',
        'lead-008',
      ]);
    }
  );

  it.each(ADMIN_LIKE)(
    '%s gets identical page 2 slices with the flag on and off',
    async (role, id) => {
      const { off, on } = await bothWays(() =>
        listLeadsAction({}, id, role, [], { page: 2, pageSize: 3 })
      );
      expect(on.total).toBe(off.total);
      expect(on.page).toBe(off.page);
      expect(on.pageSize).toBe(off.pageSize);
      expect(on.leads.map((l: any) => l.$id)).toEqual(off.leads.map((l: any) => l.$id));
      expect(off.leads).toHaveLength(3);
    }
  );

  it.each(ADMIN_LIKE)('%s gets identical counts with the flag on and off', async (role, id) => {
    const { off, on } = await bothWays(() => listLeadCountsAction(id, role, [], {}));
    expect(on).toEqual(off);
    expect(off.active).toBeGreaterThan(0);
  });

  it.each(ADMIN_LIKE)('%s export still walks and is unchanged by the flag', async (role, id) => {
    const { off, on } = await bothWays(() =>
      listLeadsAction({}, id, role, [], { forExport: true })
    );
    expect(on.leads.map((l: any) => l.$id)).toEqual(off.leads.map((l: any) => l.$id));
  });

  it('replaces the collection walk with a single paginated listDocuments call', async () => {
    process.env.LEADS_DEPT_SCOPE_INLINE = 'true';
    mockListDocuments.mockClear();
    await listLeadsAction({}, ADMIN, 'admin', [], { page: 1, pageSize: 20 });
    const leadCalls = mockListDocuments.mock.calls.filter(
      (call: any[]) => !String(call[1]).includes('user')
    );
    expect(leadCalls).toHaveLength(1);
    const queries = leadCalls[0][2] as Desc[];
    expect(queries).toContainEqual({ t: 'limit', n: 20 });
    expect(
      queries.some(
        (q) =>
          q.t === 'or' &&
          q.conds.some((c: any) => c.t === 'equal' && c.k === 'ownerId' && Array.isArray(c.v))
      )
    ).toBe(true);
  });

  it('falls back to the walk when the scope exceeds the Appwrite value cap', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const {
      buildDepartmentScopeQuery,
      DEPARTMENT_INLINE_QUERY_MAX,
    } = require('@/lib/server/department-scope-query');
    const tooMany = new Set(
      Array.from({ length: DEPARTMENT_INLINE_QUERY_MAX + 1 }, (_, i) => `u-${i}`)
    );
    expect(buildDepartmentScopeQuery(tooMany)).toBeNull();
    expect(buildDepartmentScopeQuery(new Set())).toBeNull();
    expect(buildDepartmentScopeQuery(new Set(['u-1']))).not.toBeNull();
  });
});

describe('production baseline fixture', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const baseline = require('../../fixtures/lead-visibility-baseline.json');

  it('is internally consistent', () => {
    expect(baseline.totals.leads).toBe(1352);
    expect(baseline.users).toHaveLength(baseline.totals.users);
    for (const u of baseline.users) {
      expect(typeof u.owned).toBe('number');
      expect(typeof u.assigned).toBe('number');
      expect(typeof u.doc).toBe('number');
      expect(u.app === 'DENIED' || typeof u.app === 'number').toBe(true);
    }
  });

  it('records that every admin-like role sees the same lead universe', () => {
    const adminLike = baseline.users.filter((u: any) =>
      ['admin', 'developer', 'monitor', 'operations'].includes(u.role)
    );
    expect(adminLike.length).toBeGreaterThan(0);
    const counts = new Set(adminLike.map((u: any) => u.app));
    expect(counts.size).toBe(1);
  });

  it('records that resume-department non-admin users are denied', () => {
    const denied = baseline.users.filter(
      (u: any) => u.department === 'resume' && !['admin', 'developer', 'monitor', 'operations'].includes(u.role)
    );
    for (const u of denied) expect(u.app).toBe('DENIED');
  });

  it('documents the admin document-permission gap that blocks documentSecurity', () => {
    // Admins have app-level visibility but effectively no per-document read
    // grants. Enabling documentSecurity on `leads` before backfilling grants
    // would drop them to zero. This assertion is the tripwire: if it ever
    // fails because doc counts rose, the backfill has happened and the
    // documentSecurity change can be reconsidered.
    const admins = baseline.users.filter((u: any) => u.role === 'admin');
    for (const a of admins) {
      expect(a.app).toBeGreaterThan(1000);
      expect(a.doc).toBeLessThan(10);
    }
  });
});
