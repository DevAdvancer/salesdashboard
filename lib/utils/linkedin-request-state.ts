import type { LinkedinRequest } from "@/lib/types";

export function isWithdrawnLinkedinRequest(
  request: Pick<LinkedinRequest, "status" | "isActive" | "withdrawnAt">,
) {
  // Older rows can retain their previous status after a withdrawal. Require both
  // the inactive flag and the recorded withdrawal to release such a row.
  return request.status === "withdrawn" ||
    (request.isActive === false && Boolean(request.withdrawnAt));
}
