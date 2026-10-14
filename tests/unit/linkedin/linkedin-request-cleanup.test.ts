import { planLinkedinRequestCleanup, type LinkedinRequestCleanupRow } from "@/lib/utils/linkedin-request-cleanup";

const first: LinkedinRequestCleanupRow = {
  $id: "first", $createdAt: "2026-01-01T00:00:00Z", $updatedAt: "2026-01-02T00:00:00Z",
  company: "SilverSpace Inc.", targetUrl: "linkedin.com/in/Person/",
  status: "withdrawn", isActive: false, agentId: "first-sender", accountId: "first-account",
  dateSent: "2026-01-01T00:00:00Z",
};
const second: LinkedinRequestCleanupRow = {
  $id: "second", $createdAt: "2026-02-01T00:00:00Z", $updatedAt: "2026-02-02T00:00:00Z",
  company: "Silverspace INC", targetUrl: "https://www.linkedin.com/in/person",
  status: "sent", isActive: true, agentId: "second-sender", accountId: "second-account",
  dateSent: "2026-02-01T00:00:00Z",
};

describe("LinkedIn request cleanup plan", () => {
  it("keeps the first sender and carries the active request state onto that record", () => {
    const plan = planLinkedinRequestCleanup([second, first]);
    expect(plan.duplicates).toHaveLength(1);
    expect(plan.duplicates[0]).toMatchObject({
      keeper: { $id: "first", agentId: "first-sender", accountId: "first-account" },
      remove: [{ $id: "second" }],
      keeperAfter: { company: "Silverspace INC", targetUrl: "https://www.linkedin.com/in/person",
        status: "sent", isActive: true, dateSent: second.dateSent },
    });
  });

  it("keeps another company's request for the same profile", () => {
    const plan = planLinkedinRequestCleanup([first, { ...second, company: "Vizva INC" }]);
    expect(plan.duplicates).toHaveLength(0);
    expect(plan.crossCompanyProfiles).toBe(1);
  });

  it("preserves an accepted linked lead and rewires its request reference", () => {
    const accepted = { ...second, status: "accepted", leadId: "lead-1",
      acceptedAt: "2026-02-02T00:00:00Z" };
    const plan = planLinkedinRequestCleanup([first, accepted], { second: ["lead-1"] });
    expect(plan.duplicates[0]).toMatchObject({
      keeperAfter: { status: "accepted", leadId: "lead-1", isActive: true },
      leadRewrites: [{ leadId: "lead-1", fromRequestId: "second", toRequestId: "first" }],
      blockedReason: null,
    });
  });

  it("blocks cleanup when different leads point to the same company/profile", () => {
    const plan = planLinkedinRequestCleanup([first, { ...second, leadId: "lead-1" }],
      { second: ["lead-2"] });
    expect(plan.duplicates[0].blockedReason).toMatch(/Several different leads/);
  });
});
