import { isRoleEligibleForComponent } from "@/lib/constants/component-access";
import type { LinkedinRequest, User } from "@/lib/types";

export function canUseLinkedinExtension(user: Pick<User, "role" | "department" | "isActive">) {
  return user.isActive !== false && (user.department ?? "sales") === "sales" &&
    isRoleEligibleForComponent("linkedin-requests", user.role);
}

/** Other agents' personal details and record identifiers never leave this API. */
export function projectExtensionHistory(request: LinkedinRequest, actorId: string) {
  const own = request.agentId === actorId;
  return {
    requestId: own ? request.$id : null,
    own,
    status: request.status,
    dateSent: request.dateSent,
    acceptedAt: request.acceptedAt,
    withdrawnAt: request.withdrawnAt ?? null,
    isActive: request.isActive ?? true,
  };
}

export class LinkedinExtensionError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/** Cookie-authenticated requests must come from the CRM page, not another site. */
export function assertExtensionRequest(request: Request) {
  const origin = new URL(request.url).origin;
  const source = request.headers.get("origin");
  const referer = request.headers.get("referer");
  let refererOrigin: string | null = null;
  try { refererOrigin = referer ? new URL(referer).origin : null; } catch { /* Invalid source fails closed. */ }
  if (request.headers.get("x-crm-extension") !== "linkedin-helper-v1" ||
      request.headers.get("sec-fetch-site") !== "same-origin" ||
      (source ? source !== origin : refererOrigin !== origin)) {
    throw new LinkedinExtensionError(403, "Open the extension from your connected CRM browser session.");
  }
}
