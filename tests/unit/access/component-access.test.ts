import { isRoleEligibleForComponent } from "@/lib/constants/component-access";

describe("component access eligibility", () => {
  it("allows team leads to use Linkedin Requests, manage Linkedin accounts, and view Linkedin reports", () => {
    expect(isRoleEligibleForComponent("linkedin-requests", "team_lead")).toBe(
      true,
    );
    expect(isRoleEligibleForComponent("linkedin-reports", "team_lead")).toBe(
      true,
    );
    expect(
      isRoleEligibleForComponent(
        "linkedin-account-management",
        "team_lead",
      ),
    ).toBe(true);
  });

  it("keeps monitor page visibility aligned with admin visibility", () => {
    const adminVisibleComponents = [
      "dashboard",
      "chat",
      "leads",
      "history",
      "user-management",
      "settings",
      "branch-management",
      "audit-logs",
      "mock",
      "assessment-support",
      "interview-support",
      "hierarchy",
      "work-queue",
      "reports",
      "coaching-notes",
      "review-queue",
      "notifications",
      "attendance",
      "attendance-report",
      "lead-requests",
      "linkedin-account-management",
      "linkedin-reports",
      "payments-report",
    ] as const;

    adminVisibleComponents.forEach((component) => {
      expect(isRoleEligibleForComponent(component, "monitor")).toBe(true);
    });

    expect(isRoleEligibleForComponent("field-management", "monitor")).toBe(false);
    expect(isRoleEligibleForComponent("linkedin-requests", "monitor")).toBe(false);
  });

  it("keeps operations page visibility aligned with admin visibility", () => {
    const adminVisibleComponents = [
      "dashboard",
      "chat",
      "leads",
      "history",
      "user-management",
      "settings",
      "branch-management",
      "mock",
      "assessment-support",
      "interview-support",
      "hierarchy",
      "work-queue",
      "reports",
      "coaching-notes",
      "review-queue",
      "notifications",
      "attendance",
      "attendance-report",
      "lead-requests",
      "linkedin-account-management",
      "linkedin-reports",
      "payments-report",
    ] as const;

    adminVisibleComponents.forEach((component) => {
      expect(isRoleEligibleForComponent(component, "operations" as never)).toBe(true);
    });

    expect(isRoleEligibleForComponent("field-management", "operations" as never)).toBe(false);
    expect(isRoleEligibleForComponent("audit-logs", "operations" as never)).toBe(false);
    expect(isRoleEligibleForComponent("linkedin-requests", "operations" as never)).toBe(false);
  });

  it("restricts payments-report to admin/developer/monitor/operations", () => {
    expect(isRoleEligibleForComponent("payments-report", "admin")).toBe(true);
    expect(isRoleEligibleForComponent("payments-report", "developer")).toBe(true);
    expect(isRoleEligibleForComponent("payments-report", "monitor")).toBe(true);
    expect(isRoleEligibleForComponent("payments-report", "operations" as never)).toBe(true);
    expect(isRoleEligibleForComponent("payments-report", "team_lead")).toBe(false);
    expect(isRoleEligibleForComponent("payments-report", "agent")).toBe(false);
    expect(isRoleEligibleForComponent("payments-report", "lead_generation")).toBe(false);
  });
});
