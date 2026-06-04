import { isRoleEligibleForComponent } from "@/lib/constants/component-access";

describe("component access eligibility", () => {
  it("allows team leads to use Linkedin Requests but not manage Linkedin accounts", () => {
    expect(isRoleEligibleForComponent("linkedin-requests", "team_lead")).toBe(
      true,
    );
    expect(
      isRoleEligibleForComponent(
        "linkedin-account-management",
        "team_lead",
      ),
    ).toBe(false);
  });
});
