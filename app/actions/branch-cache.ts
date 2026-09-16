"use server";

import { unstable_cache, revalidateTag } from "next/cache";
import { createAdminClient } from "@/lib/server/appwrite";
import { listAllDocuments } from "@/lib/server/appwrite-pagination";
import { COLLECTIONS } from "@/lib/constants/appwrite";
import type { Branch } from "@/lib/types";

const DATABASE_ID = process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID!;

export const getCachedBranchesAction = unstable_cache(
  async () => {
    const { databases } = await createAdminClient();
    return listAllDocuments<Branch>({
      databases,
      databaseId: DATABASE_ID,
      collectionId: COLLECTIONS.BRANCHES,
      queries: [],
    });
  },
  ['branches-list'],
  { tags: ['branches'], revalidate: 3600 }
);

export async function revalidateBranchesAction() {
  revalidateTag('branches', { expire: 0 });
}
