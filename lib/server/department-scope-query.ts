import { Query } from 'node-appwrite';

/**
 * Department visibility scope, expressed as an Appwrite query.
 *
 * Admin-like roles (admin, developer, monitor, operations) see every lead
 * owned by or assigned to a sales-department user. That scope used to be
 * applied by walking the whole leads collection and filtering in memory,
 * which costs ~200 requests to render a 20-row page. Pushing the same
 * predicate into the query lets the normal paginated listDocuments call do
 * the work in one request.
 *
 * Gated behind LEADS_DEPT_SCOPE_INLINE so the in-memory walk stays the
 * default until the query form has soaked in production.
 */

/**
 * Appwrite caps the number of values in a single query
 * (_APP_DATABASE_QUERY_MAX_VALUES, default 100). Above that we return null
 * and the caller falls back to the in-memory walk, so growth degrades to
 * the old behaviour instead of throwing.
 */
export const DEPARTMENT_INLINE_QUERY_MAX = 100;

export function buildDepartmentScopeQuery(ids: Set<string>): string | null {
  if (ids.size === 0 || ids.size > DEPARTMENT_INLINE_QUERY_MAX) return null;
  const list = [...ids];
  return Query.or([Query.equal('ownerId', list), Query.equal('assignedToId', list)]);
}

export function isDepartmentScopeInlineEnabled(): boolean {
  return process.env.LEADS_DEPT_SCOPE_INLINE === 'true';
}
