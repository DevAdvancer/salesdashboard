import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { Navigation } from "@/components/navigation";
import { useAuth } from "@/lib/contexts/auth-context";
import { useAccess } from "@/lib/contexts/access-control-context";
import { useRouter, usePathname } from "next/navigation";

// Mock the contexts and hooks
jest.mock("@/lib/contexts/auth-context");
jest.mock("@/lib/contexts/access-control-context");
// The notification bell pulls in the SOP service, which imports the
// `node-appwrite` server SDK (ESM-only dependency Jest cannot parse).
// The bell is not part of what these navigation tests assert, so stub it.
jest.mock("@/components/notification-bell", () => ({
  NotificationBell: () => null,
}));
jest.mock("next/navigation", () => ({
  useRouter: jest.fn(),
  usePathname: jest.fn(),
}));

const mockUseAuth = useAuth as jest.MockedFunction<typeof useAuth>;
const mockUseAccess = useAccess as jest.MockedFunction<typeof useAccess>;
const mockUseRouter = useRouter as jest.MockedFunction<typeof useRouter>;
const mockUsePathname = usePathname as jest.MockedFunction<typeof usePathname>;

describe("Navigation Component", () => {
  const mockPush = jest.fn();
  const mockLogout = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    mockUseRouter.mockReturnValue({ push: mockPush } as any);
    mockUsePathname.mockReturnValue("/dashboard");
  });

  describe("Agent sees only permitted components", () => {
    it("should show only dashboard and leads for agent with limited access", () => {
      mockUseAuth.mockReturnValue({
        user: {
          $id: "agent-1",
          name: "Test Agent",
          email: "agent@test.com",
          role: "agent",
          teamLeadId: "teamLead-1",
        },
        isManager: false,
        isAgent: true,
        loading: false,
        logout: mockLogout,
      } as any);

      mockUseAccess.mockReturnValue({
        canAccess: (componentKey: string) => {
          return componentKey === "dashboard" || componentKey === "leads";
        },
        loading: false,
      } as any);

      render(<Navigation />);

      expect(screen.getByText("Dashboard")).toBeInTheDocument();
      expect(screen.getByText("Leads")).toBeInTheDocument();
      expect(screen.queryByText("History")).not.toBeInTheDocument();
      expect(screen.queryByText("User Management")).not.toBeInTheDocument();
      expect(screen.queryByText("Field Management")).not.toBeInTheDocument();
      expect(screen.queryByText("Settings")).not.toBeInTheDocument();
    });
  });

  describe("TeamLead sees all components", () => {
    it("should show all navigation items for teamLead", () => {
      mockUseAuth.mockReturnValue({
        user: {
          $id: "teamLead-1",
          name: "Test TeamLead",
          email: "teamLead@test.com",
          role: "team_lead",
          teamLeadId: null,
        },
        isManager: true,
        isAgent: false,
        loading: false,
        logout: mockLogout,
      } as any);

      mockUseAccess.mockReturnValue({
        canAccess: () => true,
        loading: false,
      } as any);

      render(<Navigation />);

      expect(screen.getByText("Dashboard")).toBeInTheDocument();
      expect(screen.getByText("Leads")).toBeInTheDocument();
      expect(screen.getByText("Client")).toBeInTheDocument();
      expect(screen.getByText("Users")).toBeInTheDocument();
      // The field management module was removed from the product (its
      // COMPONENT_ACCESS entry is empty and it has no NAV_ITEMS entry), so
      // it must never appear in the sidebar, not even for a team lead.
      expect(screen.queryByText("Field Management")).not.toBeInTheDocument();
      expect(screen.getByText("Settings")).toBeInTheDocument();
      fireEvent.click(screen.getByText("Technical Support"));
      expect(screen.getByText("Mock Interview")).toBeInTheDocument();
      expect(screen.getByText("Interview Support")).toBeInTheDocument();
      expect(screen.getByText("Assessment Support")).toBeInTheDocument();
    });
  });

  describe("Navigation links work correctly", () => {
    beforeEach(() => {
      mockUseAuth.mockReturnValue({
        user: {
          $id: "user-1",
          name: "Test User",
          email: "user@test.com",
          role: "team_lead",
          teamLeadId: null,
        },
        isManager: true,
        isAgent: false,
        loading: false,
        logout: mockLogout,
      } as any);

      mockUseAccess.mockReturnValue({
        canAccess: () => true,
        loading: false,
      } as any);
    });

    // Nav entries are next/link anchors, so navigation happens through the
    // href rather than an imperative router.push. Assert the destination on
    // the rendered link instead of on the router mock.
    it("should navigate to dashboard when dashboard link is clicked", () => {
      render(<Navigation />);
      const dashboardLink = screen.getByText("Dashboard").closest("a");
      expect(dashboardLink).toHaveAttribute("href", "/dashboard");
    });

    it("should navigate to leads when leads link is clicked", () => {
      render(<Navigation />);
      const leadsLink = screen.getByText("Leads").closest("a");
      expect(leadsLink).toHaveAttribute("href", "/leads");
    });

    it("should highlight active route", () => {
      mockUsePathname.mockReturnValue("/leads");
      render(<Navigation />);
      const leadsLink = screen.getByText("Leads").closest("a");
      expect(leadsLink).toHaveClass("active");
    });
  });

  describe("Logout clears session", () => {
    beforeEach(() => {
      mockUseAuth.mockReturnValue({
        user: {
          $id: "user-1",
          name: "Test User",
          email: "user@test.com",
          role: "team_lead",
          teamLeadId: null,
        },
        isManager: true,
        isAgent: false,
        loading: false,
        logout: mockLogout,
      } as any);

      mockUseAccess.mockReturnValue({
        canAccess: () => true,
        loading: false,
      } as any);
    });

    it("should call logout and redirect to login when logout button is clicked", async () => {
      mockLogout.mockResolvedValue(undefined);
      render(<Navigation />);
      const logoutButton = screen.getByText("Sign out");
      fireEvent.click(logoutButton);
      await waitFor(() => {
        expect(mockLogout).toHaveBeenCalled();
        expect(mockPush).toHaveBeenCalledWith("/login");
      });
    });
  });
});
