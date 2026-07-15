import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import { LeadFollowUpCard } from "@/components/leads/lead-follow-up-card";
import { updateLeadFollowUp } from "@/lib/services/sop-service";
import type { Lead, User } from "@/lib/types";

jest.mock("@/lib/services/sop-service", () => ({
  updateLeadFollowUp: jest.fn(),
}));

jest.mock("@/components/ui/use-toast", () => ({
  useToast: () => ({ toast: jest.fn() }),
}));

const mockUpdateLeadFollowUp = updateLeadFollowUp as jest.MockedFunction<
  typeof updateLeadFollowUp
>;

describe("LeadFollowUpCard", () => {
  const user: User = {
    $id: "tl-1",
    name: "Team Lead",
    email: "tl@example.com",
    role: "team_lead",
    branchIds: ["branch-1"],
    branchId: "branch-1",
    teamLeadId: null,
    teamLeadIds: [],
    assistantManagerId: null,
    assistantManagerIds: [],
  };

  const lead: Lead = {
    $id: "lead-1",
    data: JSON.stringify({
      firstName: "Current",
      status: "Interested",
    }),
    status: "Interested",
    ownerId: "agent-1",
    assignedToId: "agent-1",
    branchId: "branch-1",
    isClosed: false,
    closedAt: null,
    nextFollowUpAt: "2026-06-10T14:00:00.000Z",
    nextAction: "Call",
    followUpStatus: "pending",
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("passes the saved lead back to the parent after saving follow-up details", async () => {
    const updatedLead = {
      ...lead,
      nextAction: "Email",
    };
    mockUpdateLeadFollowUp.mockResolvedValue(updatedLead);
    const onUpdated = jest.fn();

    render(
      <LeadFollowUpCard lead={lead} user={user} onUpdated={onUpdated} />,
    );

    await userEvent.selectOptions(
      screen.getByRole("combobox", { name: /Next Action/ }),
      "Email",
    );
    await userEvent.click(screen.getByRole("button", { name: "Save Follow-Up" }));

    await waitFor(() => {
      expect(onUpdated).toHaveBeenCalledWith(updatedLead);
    });
  });
});
