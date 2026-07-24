"use server";

import { unstable_cache, revalidateTag } from "next/cache";
import { listBranches } from "@/lib/services/branch-service";

export const getCachedBranchesAction = unstable_cache(
  async () => {
    return listBranches();
  },
  ['branches-list'],
  { tags: ['branches'], revalidate: 3600 }
);

export async function revalidateBranchesAction() {
  revalidateTag('branches', { expire: 0 });
}
