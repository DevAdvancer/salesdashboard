export {};

/**
 * Covers the two guards in buildDepartmentScopeQuery: the Appwrite value cap
 * and the 4096-character query-length limit.
 *
 * node-appwrite ships as ESM and Jest cannot parse it, which is why every suite
 * in this repo mocks it. So this file does not attempt to verify Appwrite's own
 * serialization. It verifies OUR guard: that a query which serializes beyond the
 * limit is rejected rather than sent.
 *
 * The serialized lengths the guard has to defend against were measured directly
 * against node-appwrite outside Jest, with 20-character Appwrite ids:
 *
 *     45 ids -> 2205 chars      (current production sales-user count)
 *     85 ids -> 4045 chars
 *     86 ids -> 4091 chars
 *     90 ids -> 4275 chars      exceeds the limit
 *     95 ids -> 4505 chars      exceeds the limit
 *    100 ids -> 4735 chars      exceeds the limit, yet within the 100-value cap
 *
 * That last row is the bug this guard fixes: a count-only check passes 100 ids
 * straight to Appwrite, which answers 400 and surfaces as "Failed to list leads".
 */

// Mirrors the real SDK closely enough for a length check: Appwrite serializes a
// query to JSON, so the string grows with the number and size of the values.
const serialize = (method: string, values: unknown[]) =>
  JSON.stringify({ method, values });

jest.mock('node-appwrite', () => ({
  Query: {
    equal: (attribute: string, values: string[]) => serialize('equal', [attribute, values]),
    or: (queries: string[]) => serialize('or', queries),
  },
}));

// Required rather than imported so it resolves after the jest.mock above.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { buildDepartmentScopeQuery, DEPARTMENT_INLINE_QUERY_MAX } = require('@/lib/server/department-scope-query');

const realisticId = (i: number) => `698a5e64002675ad${String(i).padStart(4, '0')}`;
const idSet = (count: number) => new Set(Array.from({ length: count }, (_, i) => realisticId(i)));

const APPWRITE_QUERY_MAX_LENGTH = 4096;

describe('buildDepartmentScopeQuery', () => {
  it('returns null for an empty set so the caller keeps the walk', () => {
    expect(buildDepartmentScopeQuery(new Set())).toBeNull();
  });

  it('returns a query for the current production scope', () => {
    const query = buildDepartmentScopeQuery(idSet(45));
    expect(query).not.toBeNull();
    expect(query.length).toBeLessThanOrEqual(APPWRITE_QUERY_MAX_LENGTH);
    expect(query).toContain('ownerId');
    expect(query).toContain('assignedToId');
  });

  it('returns null above the Appwrite value cap', () => {
    expect(buildDepartmentScopeQuery(idSet(DEPARTMENT_INLINE_QUERY_MAX + 1))).toBeNull();
  });

  it('returns null when the serialized query exceeds the length limit', () => {
    // Under the value cap, over the length limit. A count-only guard would have
    // let this through.
    const tooLong = idSet(DEPARTMENT_INLINE_QUERY_MAX);
    expect(tooLong.size).toBeLessThanOrEqual(DEPARTMENT_INLINE_QUERY_MAX);
    expect(buildDepartmentScopeQuery(tooLong)).toBeNull();
  });

  it('never returns a query longer than Appwrite accepts, at any size', () => {
    for (let size = 1; size <= DEPARTMENT_INLINE_QUERY_MAX; size += 1) {
      const query = buildDepartmentScopeQuery(idSet(size));
      if (query !== null) {
        expect(query.length).toBeLessThanOrEqual(APPWRITE_QUERY_MAX_LENGTH);
      }
    }
  });
});
