import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { Navigation } from "@/components/navigation";
import { getMyLinkedinConversationAccessAction } from "@/app/actions/beta";
import { useAuth } from "@/lib/contexts/auth-context";
import { useAccess } from "@/lib/contexts/access-control-context";
import { useRouter, usePathname } from "next/navigation";

// Mock the contexts and hooks
jest.mock("@/lib/contexts/auth-context");
jest.mock("@/lib/contexts/access-control-context");
jest.mock("@/app/actions/beta", () => ({ getMyLinkedinConversationAccessAction: jest.fn() }));
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
    jest.useFakeTimers().setSystemTime(new Date('2026-11-20T14:00:00Z'));
    mockUseRouter.mockReturnValue({ push: mockPush } as any);
    mockUsePathname.mockReturnValue("/dashboard");
  });
  afterEach(() => jest.useRealTimers());

  it.each(['sales', 'resume'])('hides Client Progress from the Resume dashboard for %s accounts', department => {
    mockUseAuth.mockReturnValue({ user: { $id: 'admin', name: 'Admin', role: 'admin', department },
      isResumeTeam: department === 'resume', activeDashboard: 'resume', logout: mockLogout } as any);
    mockUseAccess.mockReturnValue({ canAccess: () => true, isLoading: false } as any);
    render(<Navigation />);
    expect(screen.queryByText('Client Progress')).not.toBeInTheDocument();
  });

  it('keeps Client Progress in the Sales dashboard', () => {
    mockUseAuth.mockReturnValue({ user: { $id: 'admin', name: 'Admin', role: 'admin', department: 'sales' },
      isResumeTeam: false, activeDashboard: 'sales', logout: mockLogout } as any);
    mockUseAccess.mockReturnValue({ canAccess: () => true, isLoading: false } as any);
    render(<Navigation />);
    expect(screen.getByText('Client Progress')).toBeInTheDocument();
  });

  it('shows Accepted Connections by role without a beta lookup', async () => {
    mockUseAuth.mockReturnValue({ user: { $id: 'agent', name: 'Agent', role: 'agent', department: 'sales' },
      activeDashboard: 'sales', serverSessionReady: true, logout: mockLogout } as any);
    mockUseAccess.mockReturnValue({ canAccess: (key: string) => key !== 'beta', isLoading: false } as any);
    render(<Navigation />);
    fireEvent.click(screen.getByRole('button', { name: 'Linkedin Tools' }));
    expect(await screen.findByRole('link', { name: 'Accepted Connections' })).toHaveAttribute('href', '/linkedin-conversations');
    expect(screen.queryByRole('link', { name: 'Beta' })).not.toBeInTheDocument();
    expect(getMyLinkedinConversationAccessAction).not.toHaveBeenCalled();
  });

  it('keeps the Beta page in admin navigation', () => {
    mockUseAuth.mockReturnValue({ user: { $id: 'admin', name: 'Admin', role: 'admin', department: 'sales' },
      activeDashboard: 'sales', serverSessionReady: true, logout: mockLogout } as any);
    mockUseAccess.mockReturnValue({ canAccess: () => true, isLoading: false } as any);
    render(<Navigation />);
    expect(screen.getByRole('link', { name: 'Beta' })).toHaveAttribute('href', '/beta');
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
