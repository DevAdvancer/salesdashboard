import fc from "fast-check";
import { canUseLinkedinExtension, projectExtensionHistory } from "@/lib/server/linkedin-extension-policy";
import { VALID_ROLES, type LinkedinRequest } from "@/lib/types";
import { isRoleEligibleForComponent } from "@/lib/constants/component-access";

describe("LinkedIn extension access invariants", () => {
  it("never admits inactive users or resume users and follows the existing component roles", () => {
    fc.assert(fc.property(fc.constantFrom(...VALID_ROLES), fc.constantFrom("sales", "resume"), fc.boolean(),
      (role, department, isActive) => {
        const allowed = canUseLinkedinExtension({ role, department: department as "sales" | "resume", isActive });
        expect(allowed).toBe(isActive && department === "sales" && isRoleEligibleForComponent("linkedin-requests", role));
      }));
  });

  it("does not reveal another agent's IDs, account, company, lead, or phone in history", () => {
    fc.assert(fc.property(fc.uuid(), fc.uuid(), fc.string(), (actorId, ownerId, phone) => {
      const request = { $id: "request-secret", agentId: ownerId, accountId: "account-secret", company: "company-secret",
        targetUrl: "https://www.linkedin.com/in/person", coldCallPhone: phone, leadId: "lead-secret", teamLeadId: "tl-secret",
        status: "sent", dateSent: "2026-10-06T00:00:00.000Z", acceptedAt: null, withdrawnAt: null } as LinkedinRequest;
      const visible = projectExtensionHistory(request, actorId);
      expect(visible.own).toBe(actorId === ownerId);
      expect(visible.requestId).toBe(actorId === ownerId ? request.$id : null);
      for (const key of ["agentId", "accountId", "company", "coldCallPhone", "leadId", "teamLeadId", "targetUrl"]) {
        expect(visible).not.toHaveProperty(key);
      }
    }));
  });
});
