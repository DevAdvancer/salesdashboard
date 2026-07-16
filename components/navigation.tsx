"use client";

import { useAuth } from "@/lib/contexts/auth-context";
import { useAccess, ComponentKey } from "@/lib/contexts/access-control-context";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import {
  Bell,
  Briefcase,
  ChevronDown,
  FileText,
  LogOut,
  Map,
  Menu,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Repeat,
  Wrench,
  X,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { NAV_ITEMS, appIcons } from "./navigation-config";
import { NotificationBell } from "./notification-bell";
import {
  startDashboardTour,
  startLeadsTour,
  startClientsTour,
  startWorkQueueTour,
  startGenericTour,
  startLeadDetailTour,
} from "@/lib/utils/tour-guide";

function formatRoleLabel(role: string): string {
  if (role === "team_lead") return "Team Lead";
  if (role === "lead_generation") return "Lead Generation";
  if (role === "monitor") return "Monitor";
  if (role === "operations") return "Operations";
  return role.charAt(0).toUpperCase() + role.slice(1);
}

// Universal sidebar items that the Resume team should keep alongside the
// Resume Dashboard. The dashboard and chat are not department-specific and
// the leadership roles always see them too. `user-management` is also
// surfaced to resume team members so a resume team lead can manage their
// own roster without switching to the sales view; access control still
// gates the page itself (only roles eligible for `user-management` see it).
const RESUME_UNIVERSAL_ITEM_KEYS = new Set([
  "resume-chat",
  "resume-hierarchy",
  "user-management",
]);

interface NavigationProps {
  isCollapsed?: boolean;
  onCollapsedChange?: (isCollapsed: boolean) => void;
}

export function Navigation({
  isCollapsed = false,
  onCollapsedChange = () => {},
}: NavigationProps = {}) {
  const { user, logout, isResumeTeam, canSwitchDashboard, activeDashboard, setActiveDashboard } = useAuth();
  const { canAccess, isLoading: accessLoading } = useAccess();
  const router = useRouter();
  const pathname = usePathname();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [linkedinOpen, setLinkedinOpen] = useState(false);
  const [technicalOpen, setTechnicalOpen] = useState(false);
  const [attendanceOpen, setAttendanceOpen] = useState(true);

  const handleLogout = async () => {
    try {
      await logout();
      router.push("/login");
    } catch (e) {
      console.error("Logout error:", e);
    }
  };

  if (!user) return null;

  const visibleItems = accessLoading
    ? []
    : NAV_ITEMS.filter((item) => canAccess(item.key as ComponentKey));

  // Define section grouping
  const agentItemKeys = new Set(["dashboard", "leads", "history", "request-calls", "work-queue"]);
  const attendanceItemKeys = new Set(["attendance", "attendance-report"]);
  const teamLeadItemKeys = new Set(["user-management", "reports", "coaching-notes", "review-queue"]);
  const adminItemKeys = new Set(["branch-management", "hierarchy", "lead-requests", "audit-logs", "settings"]);
  const technicalItemKeys = new Set(["mock", "interview-support", "assessment-support"]);
  const linkedinItemKeys = new Set(["linkedin-requests", "linkedin-account-management", "linkedin-reports"]);
  const paymentsItemKeys = new Set(["payments-report", "target-report", "technical-payments", "followups-payments"]);
  const resumeItemKeys = new Set(["resume-dashboard", "resume-profiles", "call-requests", "resume-hierarchy"]);

  // Resume-team members get a slim sidebar: the Resume Dashboard, the
  // Resume Team chat, and (for the resume team lead) User Management so
  // they can manage their own roster. Sales-only modules are filtered
  // out so resume users don't see Leads, Reports, etc. Admin / Monitor
  // / Operations continue to see every section because canAccess()
  // opens them all.
  const itemsForUser = isResumeTeam
    ? visibleItems.filter(
        (item) => resumeItemKeys.has(item.key) || RESUME_UNIVERSAL_ITEM_KEYS.has(item.key)
      )
    : visibleItems;

  // Filter items by section
  const agentItems = itemsForUser.filter((item) => agentItemKeys.has(item.key));
  const attendanceItems = itemsForUser.filter((item) => attendanceItemKeys.has(item.key));
  // `user-management` is rendered inside the Resume Team section when
  // the Resume Team section is visible (resume team members always, plus
  // leadership on the resume view). Strip it from the sales team-lead
  // section whenever the resume section is going to be rendered to
  // avoid a duplicate.
  const teamLeadItems = itemsForUser.filter(
    (item) =>
      teamLeadItemKeys.has(item.key) &&
      !(item.key === "user-management" && (isResumeTeam || activeDashboard === "resume")),
  );
  const adminItems = itemsForUser.filter((item) => adminItemKeys.has(item.key));
  const technicalItems = itemsForUser.filter((item) => technicalItemKeys.has(item.key));
  const linkedinItems = itemsForUser.filter((item) => linkedinItemKeys.has(item.key));
  const paymentsItems = itemsForUser.filter((item) => paymentsItemKeys.has(item.key));
  // The collapsible Chatting section is driven by the sales "chat" item on the
  // Sales sidebar and the "resume-chat" item on the Resume sidebar (resume
  // users never have the "chat" key in itemsForUser, only "resume-chat").
  const chatItem =
    itemsForUser.find((item) => item.key === "chat") ??
    itemsForUser.find((item) => item.key === "resume-chat") ??
    null;
  // Resume CRM uses its own chat channels; route the collapsible chat
  // section to /resume-chat/* when the user is on the Resume sidebar so
  // announcement / general open the resume counterparts, not the sales
  // ones. Sales sidebar keeps the original /chat/* URLs.
  const chatHrefPrefix = activeDashboard === "resume" ? "/resume-chat" : "/chat";

  // Helper to render a standard nav button
  const renderNavButton = (item: typeof NAV_ITEMS[0]) => {
    const Icon = item.icon;
    const isActive =
      pathname === item.href ||
      (pathname?.startsWith(item.href) && pathname.charAt(item.href.length) === "/");
    return (
      <Link
        key={item.key}
        id={`nav-${item.key}`}
        href={item.href}
        prefetch
        onClick={() => setMobileMenuOpen(false)}
        className={`nav-item${isActive ? " active" : ""}`}
        title={item.label}
      >
        <Icon size={16} />
        <span className={isCollapsed ? "lg:sr-only" : ""}>{item.label}</span>
      </Link>
    );
  };

  // Helper to render a section header
  const renderSectionHeader = (title: string) => {
    if (isCollapsed) {
      return <div className="my-2 border-t border-border/50 mx-2" />;
    }
    return (
      <div className="px-3 py-2 mt-2 mb-1 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
        {title}
      </div>
    );
  };

  // Collapsible Sections
  const renderCollapsibleSection = (
    title: string,
    icon: any,
    items: typeof NAV_ITEMS,
    isOpen: boolean,
    setIsOpen: React.Dispatch<React.SetStateAction<boolean>>
  ) => {
    if (items.length === 0) return null;
    const Icon = icon;
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "1px" }}>
        <button
          type="button"
          onClick={() => setIsOpen((v) => !v)}
          className="nav-item"
          aria-expanded={isOpen}
          title={title}
          style={{ justifyContent: isCollapsed ? "center" : "flex-start" }}
        >
          <Icon size={16} />
          <span className={isCollapsed ? "lg:sr-only" : ""} style={{ flex: 1 }}>
            {title}
          </span>
          {!isCollapsed && (
            <ChevronDown
              size={16}
              style={{
                transform: isOpen ? "rotate(180deg)" : "rotate(0deg)",
                transition: "transform 0.12s ease",
              }}
            />
          )}
        </button>

        {isOpen && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "1px",
              paddingLeft: isCollapsed ? 0 : "0.75rem",
            }}
          >
            {items.map((item) => {
              const ItemIcon = item.icon;
              const isActive =
                pathname === item.href ||
                (pathname?.startsWith(item.href) && pathname.charAt(item.href.length) === "/");
              return (
                <Link
                  key={item.key}
                  id={`nav-${item.key}`}
                  href={item.href}
                  prefetch
                  onClick={() => setMobileMenuOpen(false)}
                  className={`nav-item${isActive ? " active" : ""}`}
                  title={item.label}
                  style={{ paddingLeft: isCollapsed ? undefined : "1.25rem" }}
                >
                  <ItemIcon size={16} />
                  <span className={isCollapsed ? "lg:sr-only" : ""}>{item.label}</span>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  const chatSection = chatItem ? (
    <div style={{ display: "flex", flexDirection: "column", gap: "1px" }}>
      <button
        type="button"
        onClick={() => setChatOpen((v) => !v)}
        className="nav-item"
        aria-expanded={chatOpen}
        title="Chatting"
        style={{ justifyContent: isCollapsed ? "center" : "flex-start" }}
      >
        <MessageSquare size={16} />
        <span className={isCollapsed ? "lg:sr-only" : ""} style={{ flex: 1 }}>
          Chatting
        </span>
        {!isCollapsed && (
          <ChevronDown
            size={16}
            style={{
              transform: chatOpen ? "rotate(180deg)" : "rotate(0deg)",
              transition: "transform 0.12s ease",
            }}
          />
        )}
      </button>

      {chatOpen && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "1px",
            paddingLeft: isCollapsed ? 0 : "0.75rem",
          }}
        >
          {[
            { key: "chat-announcement", label: "Announcement", href: `${chatHrefPrefix}/announcement`, icon: Bell },
            { key: "chat-general", label: "General", href: `${chatHrefPrefix}/general`, icon: MessageSquare },
          ].map((item) => {
            const ItemIcon = item.icon;
            const isActive =
              pathname === item.href ||
              (pathname?.startsWith(item.href) && pathname.charAt(item.href.length) === "/");
            return (
              <Link
                key={item.key}
                id={`nav-${item.key}`}
                href={item.href}
                prefetch
                onClick={() => setMobileMenuOpen(false)}
                className={`nav-item${isActive ? " active" : ""}`}
                title={item.label}
                style={{ paddingLeft: isCollapsed ? undefined : "1.25rem" }}
              >
                <ItemIcon size={16} />
                <span className={isCollapsed ? "lg:sr-only" : ""}>{item.label}</span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  ) : null;

  const renderedItems: ReactNode[] = [];

  // Resume CRM sidebar is rendered as its own dedicated layout: Resume
  // Dashboard at the top, a collapsible Chatting section (announcement +
  // general), and Users under Management. Sales-only sections (Leads,
  // Reports, Attendance, LinkedIn, etc.) are intentionally hidden — a
  // user who flipped the switcher into Resume mode is operating the
  // Resume workspace, not the Sales one. On the Sales CRM sidebar, no
  // Resume section is rendered at all (it's pinned to the Resume view).
  if (activeDashboard === "resume") {
    const resumeDashboardItem =
      itemsForUser.find((item) => item.key === "resume-dashboard") ?? null;
    const resumeProfilesItem =
      itemsForUser.find((item) => item.key === "resume-profiles") ?? null;
    const resumeHierarchyItem =
      itemsForUser.find((item) => item.key === "resume-hierarchy") ?? null;
    const resumeCallsItem =
      itemsForUser.find((item) => item.key === "call-requests") ?? null;
    const resumeUserMgmtItem =
      itemsForUser.find((item) => item.key === "user-management") ?? null;

    if (resumeDashboardItem || resumeProfilesItem || resumeCallsItem) {
      renderedItems.push(
        <div key="section-resume-workspace">
          {renderSectionHeader("Resume Workspace")}
          {resumeDashboardItem && renderNavButton(resumeDashboardItem)}
          {resumeCallsItem && renderNavButton(resumeCallsItem)}
          {resumeProfilesItem && renderNavButton(resumeProfilesItem)}
        </div>
      );
    }

    if (resumeHierarchyItem) {
      renderedItems.push(
        <div key="section-resume-hierarchy">
          {renderSectionHeader("Resume Structure")}
          {renderNavButton(resumeHierarchyItem)}
        </div>
      );
    }

    renderedItems.push(
      <div key="section-resume-chat">
        {renderSectionHeader("Chatting")}
        {chatSection}
      </div>
    );

    if (resumeUserMgmtItem) {
      renderedItems.push(
        <div key="section-resume-management">
          {renderSectionHeader("Management")}
          {renderNavButton(resumeUserMgmtItem)}
        </div>
      );
    }
  } else {
    // Determine section titles based on role
    let coreWorkspaceTitle = "My Workspace";
    let managementTitle = "Team Management";
    let adminTitle = "System Admin";

    if (user.role === "admin" || user.role === "developer") {
      coreWorkspaceTitle = "Main Menu";
      managementTitle = "Management";
      adminTitle = "System Administration";
    } else if (user.role === "team_lead") {
      coreWorkspaceTitle = "Main Menu";
      managementTitle = "Team Management";
    } else {
      coreWorkspaceTitle = "My Workspace";
    }

    // 1. Agent Workspace
    if (agentItems.length > 0 || chatItem) {
      renderedItems.push(
        <div key="section-agent">
          {renderSectionHeader(coreWorkspaceTitle)}
          {agentItems.map(renderNavButton)}
          {chatSection}
        </div>
      );
    }

    // 1b. Attendance Section
    if (attendanceItems.length > 0) {
      const CalendarIcon = appIcons.attendance;
      renderedItems.push(
        <div key="section-attendance">
          {renderSectionHeader("Attendance")}
          {renderCollapsibleSection("Attendance", CalendarIcon, attendanceItems, attendanceOpen, setAttendanceOpen)}
        </div>
      );
    }

    // 2. Team Lead Dashboard
    if (teamLeadItems.length > 0 || paymentsItems.length > 0) {
      renderedItems.push(
        <div key="section-tl">
          {renderSectionHeader(managementTitle)}
          {teamLeadItems.map(renderNavButton)}
          {paymentsItems.map(renderNavButton)}
        </div>
      );
    }

    // 3. Admin Console
    if (adminItems.length > 0) {
      renderedItems.push(
        <div key="section-admin">
          {renderSectionHeader(adminTitle)}
          {adminItems.map(renderNavButton)}
        </div>
      );
    }

    // 4. Add-ons & Support
    if (technicalItems.length > 0 || linkedinItems.length > 0) {
      renderedItems.push(
        <div key="section-addons">
          {renderSectionHeader("Add-ons")}
          {renderCollapsibleSection("Technical Support", Wrench, technicalItems, technicalOpen, setTechnicalOpen)}
          {renderCollapsibleSection("Linkedin Tools", Map, linkedinItems, linkedinOpen, setLinkedinOpen)}
        </div>
      );
    }
  }


  return (
    <>
      {/* ── Mobile toggle ── */}
      <div className="lg:hidden fixed top-3 left-3 z-50">
        <button
          id="mobile-menu-toggle"
          onClick={() => setMobileMenuOpen((v) => !v)}
          style={{
            width: "2.5rem",
            height: "2.5rem",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: "0.5rem",
            background: "var(--soft-cloud)",
            border: "1px solid var(--border)",
            color: "var(--ink)",
            cursor: "pointer",
            transition: "background 0.12s ease, color 0.12s ease",
          }}>
          {mobileMenuOpen ? <X size={18} /> : <Menu size={18} />}
        </button>
      </div>

      {/* ── Mobile backdrop ── */}
      {mobileMenuOpen && (
        <div
          onClick={() => setMobileMenuOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 40,
            background: "rgba(17,17,17,0.42)",
          }}
        />
      )}

      {/* ── Sidebar ── */}
      <aside
        className={`fixed top-0 left-0 h-full w-64 flex flex-col z-40 transition-[width,transform] duration-300 lg:translate-x-0 ${isCollapsed ? "sidebar-collapsed lg:w-20" : "lg:w-64"} ${mobileMenuOpen ? "translate-x-0" : "-translate-x-full"}`}
        style={{
          background: "var(--sidebar)",
          borderRight: "1px solid var(--border)",
        }}>
        {/* Brand */}
        <div
          className={`flex items-start border-b border-border p-5 ${isCollapsed ? "lg:items-center lg:justify-center lg:p-3" : ""}`}>
          <div className={`min-w-0 flex-1 ${isCollapsed ? "lg:hidden" : ""}`}>
            <div
              className="brand-accent-bar"
              style={{ marginBottom: "0.625rem" }}
            />
            <div className={isCollapsed ? "lg:sr-only" : ""}>
              <h1
                style={{
                  fontFamily:
                    "'Bebas Neue', 'Anton', 'Arial Narrow', Arial, sans-serif",
                  fontWeight: 400,
                  fontSize: "1.5rem",
                  color: "var(--foreground)",
                  lineHeight: 1.2,
                  margin: 0,
                  textTransform: "uppercase",
                }}>
                {activeDashboard === "resume" ? "RESUMEHUB CRM" : "SalesHub CRM"}
              </h1>
              <p
                style={{
                  fontSize: "0.6875rem",
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                  color: "var(--muted-foreground)",
                  marginTop: "0.1875rem",
                }}>
                {activeDashboard === "resume" ? "Resume Intelligence" : "Sales Intelligence"}
              </p>
            </div>
          </div>

          <div className="hidden lg:flex items-center gap-2 shrink-0">
            <NotificationBell />
            <button
              type="button"
              aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              aria-pressed={isCollapsed}
              title={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              onClick={() => onCollapsedChange(!isCollapsed)}
              className="flex size-10 shrink-0 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
              {isCollapsed ? (
                <PanelLeftOpen size={17} />
              ) : (
                <PanelLeftClose size={17} />
              )}
            </button>
          </div>
        </div>

        {/* Nav links */}
        <nav style={{ flex: 1, padding: "0.625rem", overflowY: "auto" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "1px" }}>
            {renderedItems}
          </div>
        </nav>

        {/* View-as switcher — visible only to leadership roles
            (admin/developer/monitor/operations) who can preview both
            dashboards from a single login. Segmented toggle, not a
            <select>, so the active state is obvious at a glance. */}
        {canSwitchDashboard && (
          <div
            style={{
              padding: "0.75rem",
              paddingBottom: 0,
              borderTop: "1px solid var(--border)",
            }}>
            <div
              className={isCollapsed ? "lg:justify-center lg:gap-0" : ""}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
                padding: "0.375rem 0.625rem",
                marginBottom: "0.375rem",
              }}
              title={`Currently viewing: ${activeDashboard === "resume" ? "Resume" : "Sales"} dashboard`}>
              <Repeat
                size={14}
                style={{ color: "var(--muted-foreground)", flexShrink: 0 }}
                aria-hidden
              />
              <span
                className={isCollapsed ? "lg:sr-only" : ""}
                style={{
                  fontSize: "0.6875rem",
                  fontWeight: 600,
                  color: "var(--muted-foreground)",
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                }}>
                View as
              </span>
            </div>

            <div
              role="tablist"
              aria-label="View as dashboard"
              className={isCollapsed ? "lg:flex lg:flex-col lg:gap-1" : ""}
              style={{
                display: "flex",
                gap: "0.25rem",
                padding: "0.25rem",
                borderRadius: "0.5rem",
                background: "var(--soft-cloud)",
                border: "1px solid var(--border)",
                marginBottom: "0.5rem",
              }}>
              {(
                [
                  { value: "sales", label: "Sales", Icon: Briefcase },
                  { value: "resume", label: "Resume", Icon: FileText },
                ] as const
              ).map(({ value, label, Icon }) => {
                const selected = activeDashboard === value;
                return (
                  <button
                    key={value}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    aria-label={`View as ${label} dashboard`}
                    onClick={() => {
                      if (selected) return;
                      setActiveDashboard(value);
                      // Route the user to the matching dashboard so the
                      // change is immediately visible. ProtectedRoute will
                      // then decide whether to keep them.
                      const target = value === "resume" ? "/resume-dashboard" : "/dashboard";
                      if (pathname !== target) {
                        router.push(target);
                      }
                    }}
                    style={{
                      flex: 1,
                      minWidth: 0,
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: "0.375rem",
                      height: "1.875rem",
                      padding: "0 0.5rem",
                      border: "none",
                      borderRadius: "0.375rem",
                      background: selected ? "var(--canvas)" : "transparent",
                      boxShadow: selected
                        ? "0 1px 2px rgba(0,0,0,0.08), 0 0 0 1px var(--border)"
                        : "none",
                      color: selected
                        ? "var(--foreground)"
                        : "var(--muted-foreground)",
                      fontSize: "0.8125rem",
                      fontWeight: selected ? 600 : 500,
                      cursor: selected ? "default" : "pointer",
                      transition:
                        "background 0.12s ease, color 0.12s ease, box-shadow 0.12s ease",
                      whiteSpace: "nowrap",
                    }}
                    onMouseEnter={(e) => {
                      if (selected) return;
                      (e.currentTarget as HTMLButtonElement).style.color =
                        "var(--foreground)";
                    }}
                    onMouseLeave={(e) => {
                      if (selected) return;
                      (e.currentTarget as HTMLButtonElement).style.color =
                        "var(--muted-foreground)";
                    }}>
                    <Icon size={13} aria-hidden />
                    <span className={isCollapsed ? "lg:sr-only" : ""}>
                      {label}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* User */}
        <div
          style={{ padding: "0.75rem", borderTop: "1px solid var(--border)" }}>
          <div
            className={isCollapsed ? "lg:justify-center" : ""}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.625rem",
              padding: "0.5rem 0.625rem",
              borderRadius: "1.5rem",
              background: "var(--soft-cloud)",
              marginBottom: "0.375rem",
            }}
            title={`${user.name} - ${formatRoleLabel(user.role)}`}>
            {/* Avatar */}
            <div
              style={{
                width: "2rem",
                height: "2rem",
                borderRadius: "50%",
                flexShrink: 0,
                background: "var(--ink)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}>
              <span
                style={{
                  fontSize: "0.8125rem",
                  fontWeight: 600,
                  color: "var(--canvas)",
                  fontFamily: "'Inter', 'Helvetica Neue', Arial, sans-serif",
                }}>
                {user.name?.charAt(0).toUpperCase() ?? "U"}
              </span>
            </div>
            <div
              className={isCollapsed ? "lg:sr-only" : ""}
              style={{ minWidth: 0, flex: 1 }}>
              <p
                style={{
                  fontSize: "0.8125rem",
                  fontWeight: 500,
                  color: "var(--foreground)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  margin: 0,
                  lineHeight: 1.3,
                }}>
                {user.name}
              </p>
              <p
                style={{
                  fontSize: "0.6875rem",
                  color: "var(--muted-foreground)",
                  margin: 0,
                }}>
                {formatRoleLabel(user.role)}
              </p>
            </div>
          </div>

          {user.role !== "admin" && (
            <button
              onClick={() => {
                setMobileMenuOpen(false);
                if (pathname === "/dashboard") {
                  startDashboardTour(user.role);
                } else if (pathname === "/leads") {
                  startLeadsTour(user.role);
                } else if (
                  pathname.startsWith("/leads/") &&
                  pathname !== "/leads/new"
                ) {
                  startLeadDetailTour(user.role);
                } else if (pathname === "/clients") {
                  startClientsTour(user.role);
                } else if (pathname === "/work-queue") {
                  startWorkQueueTour(user.role);
                } else {
                  startGenericTour();
                }
              }}
              title="Page Guide"
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
                width: "100%",
                padding: "0.4375rem 0.625rem",
                borderRadius: "9999px",
                border: "none",
                background: "transparent",
                fontSize: "0.875rem",
                color: "var(--muted-foreground)",
                cursor: "pointer",
                transition: "background 0.12s ease, color 0.12s ease",
                marginBottom: "0.25rem",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLButtonElement).style.background =
                  "var(--soft-cloud)";
                (e.currentTarget as HTMLButtonElement).style.color =
                  "var(--foreground)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.background =
                  "transparent";
                (e.currentTarget as HTMLButtonElement).style.color =
                  "var(--muted-foreground)";
              }}>
              <Map size={14} />
              <span className={isCollapsed ? "lg:sr-only" : ""}>
                Page Guide
              </span>
            </button>
          )}

          <button
            onClick={handleLogout}
            title="Sign out"
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
              width: "100%",
              padding: "0.4375rem 0.625rem",
              borderRadius: "9999px",
              border: "none",
              background: "transparent",
              fontSize: "0.875rem",
              color: "var(--muted-foreground)",
              cursor: "pointer",
              transition: "background 0.12s ease, color 0.12s ease",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background =
                "rgba(181,51,51,0.10)";
              (e.currentTarget as HTMLButtonElement).style.color =
                "var(--sale)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background =
                "transparent";
              (e.currentTarget as HTMLButtonElement).style.color =
                "var(--muted-foreground)";
            }}>
            <LogOut size={14} />
            <span className={isCollapsed ? "lg:sr-only" : ""}>Sign out</span>
          </button>
        </div>
      </aside>
    </>
  );
}
