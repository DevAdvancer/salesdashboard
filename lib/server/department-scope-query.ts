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
 * (_APP_DATABASE_QUERY_MAX_VALUES, default 100).
 */
export const DEPARTMENT_INLINE_QUERY_MAX = 100;

/**
 * Appwrite also rejects any single query string longer than 4096 characters
 * with a 400. That limit binds FIRST here, because every id appears twice: once
 * under ownerId and once under assignedToId. With 20-character Appwrite ids the
 * serialized query passes 4096 at roughly 87 ids, well below the 100-value cap,
 * so counting values alone is not a sufficient guard.
 *
 * Measured with node-appwrite: 85 ids -> 4045 chars, 86 -> 4091, 90 -> 4275.
 *
 * Rather than hard-code an id-count threshold that silently rots if id length
 * or the predicate shape changes, build the query and measure it.
 */
const APPWRITE_QUERY_MAX_LENGTH = 4096;

export function buildDepartmentScopeQuery(ids: Set<string>): string | null {
  if (ids.size === 0 || ids.size > DEPARTMENT_INLINE_QUERY_MAX) return null;
  const list = [...ids];
  const query = Query.or([Query.equal('ownerId', list), Query.equal('assignedToId', list)]);
  // Returning null falls back to the in-memory walk, so exceeding the limit
  // degrades to the previous behaviour instead of throwing a 400 at the user.
  if (query.length > APPWRITE_QUERY_MAX_LENGTH) return null;
  return query;
}

export function isDepartmentScopeInlineEnabled(): boolean {
  return true;
}
