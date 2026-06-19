import { revalidateTag, unstable_cache } from 'next/cache';
import { Query } from 'node-appwrite';

import type { Department } from '@/lib/types';
import { COLLECTIONS } from '@/lib/constants/appwrite';
import { listAllDocuments } from '@/lib/server/appwrite-pagination';

/**
 * Cached department-scoped user ID set. The underlying Appwrite query walks
 * up to 50K user docs; on a hot path (every listLeadsAction / listLeadCountsAction
 * call from admin / team_lead / monitor / operations roles) this dominates
 * server CPU and read throughput. Cache for 5 minutes on the Next.js data cache.
 *
 * Invalidation: import and call {@link invalidateDepartmentScopedUserIds}
 * from any user-management write path (create / update / delete / setActive).
 *
 * Implementation note: this module lives under lib/server/ rather than
 * lib/utils/ so the `next/cache` import is only loaded for Server Components
 * and Server Actions. Client bundles and Jest test environments that don't
 * resolve `next/cache`'s web-spec-extension chain stay unaffected.
 */

const DATABASE_ID = process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID!;

function normalizeDepartment(value: unknown): Department {
  return value === 'resume' ? 'resume' : 'sales';
}

const loaderFor = (department: Department) =>
  unstable_cache(
    async () => {
      const { createAdminClient } = await import('@/lib/server/appwrite');
      const { databases } = await createAdminClient();

      // Project just $id and department — the per-user payload is otherwise
      // ~80% larger (avatar URL, prefs, timestamps, etc.) and we throw it
      // away immediately. Cuts this 50K-user walk from ~30MB to ~3MB.
      const users = await listAllDocuments<{
        $id: string;
        department?: string;
      }>({
        databases,
        databaseId: DATABASE_ID,
        collectionId: COLLECTIONS.USERS,
        queries: [
          Query.select(['$id', 'department']),
          Query.orderAsc('$id'),
        ],
        pageLimit: 100,
        maxPages: 500,
      });

      return users
        .filter((user) => normalizeDepartment(user.department) === department)
        .map((user) => user.$id);
    },
    ['department-scoped-user-ids', department],
    {
      revalidate: 300,
      tags: ['department-scoped-user-ids', `dept:${department}`],
    },
  );

export async function getDepartmentScopedUserIds(
  department: Department,
): Promise<Set<string>> {
  const ids = await loaderFor(department)();
  return new Set(ids);
}

/** Drop the cached set. Call from user-management write paths. */
export function invalidateDepartmentScopedUserIds(): void {
  revalidateTag('department-scoped-user-ids', { expire: 60 });
}