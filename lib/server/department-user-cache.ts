import { revalidateTag, unstable_cache } from 'next/cache';
import { Query } from 'node-appwrite';

import { COLLECTIONS } from '@/lib/constants/appwrite';
import { listAllDocuments } from '@/lib/server/appwrite-pagination';
import type { Department } from '@/lib/types';

/**
 * Cached department-scoped user ID set.
 *
 * The underlying Appwrite query walks every user in the database (up to 50K
 * docs) and projects only `$id` + `department`. On a hot path — every
 * `listLeadsAction` / `listLeadCountsAction` call from `admin`, `team_lead`,
 * `monitor`, and `operations` roles — that walk dominates server CPU and
 * Appwrite read throughput. The Next.js data cache gives us 5-minute stickiness
 * for free and is invalidated explicitly by user-management write paths.
 *
 * Invalidation: call {@link invalidateDepartmentScopedUserIds} from any code
 * path that creates, updates, retires, reactivates, or deletes a user
 * (see app/actions/user.ts).
 *
 * The function lives under `lib/server/` rather than `lib/utils/` so the
 * `next/cache` import is bundled only into server entry points. Client
 * bundles are unaffected.
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

      const users = await listAllDocuments<{
        $id: string;
        department?: string;
      }>({
        databases,
        databaseId: DATABASE_ID,
        collectionId: COLLECTIONS.USERS,
        // Project just $id and department — the per-user payload is otherwise
        // ~80% larger (avatar URL, prefs, timestamps, etc.) and we throw it
        // away immediately. Cuts this 50K-user walk from ~30MB to ~3MB.
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
