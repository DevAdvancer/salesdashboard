import {
  getLeadCreateStatusOptions,
  getLeadEditAllowedStatuses,
  isAllowedLeadStatusTransition,
} from "@/lib/utils/lead-status-workflow";

describe("lead status workflow", () => {
  it("only allows Interested and Not Interested while creating a lead", () => {
    expect(getLeadCreateStatusOptions()).toEqual([
      "Interested",
      "Not Interested",
    ]);
  });

  it("allows Pipeline / Follow up after Interested", () => {
    expect(getLeadEditAllowedStatuses("Interested")).toEqual([
      "Interested",
      "Pipeline / Follow up",
    ]);
  });

  it("allows final statuses after Pipeline / Follow up", () => {
    expect(getLeadEditAllowedStatuses("Pipeline / Follow up")).toEqual([
      "Pipeline / Follow up",
      "Signed/Closure",
      "Backed Out",
    ]);
  });

  it("rejects jumping directly from Interested to Signed/Closure", () => {
    expect(isAllowedLeadStatusTransition("Interested", "Signed/Closure")).toBe(
      false,
    );
  });
});
