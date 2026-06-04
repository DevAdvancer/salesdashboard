"use client";

import { useAuth } from "@/lib/contexts/auth-context";
import { useAccess, ComponentKey } from "@/lib/contexts/access-control-context";
import { useRouter, usePathname } from "next/navigation";
import {
  Bell,
  ChevronDown,
  LogOut,
  Map,
  Menu,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Wrench,
  X,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { NAV_ITEMS } from "./navigation-config";
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
  if (role === "assistant_manager") return "Assistant Manager";
  if (role === "lead_generation") return "Lead Generation";
  if (role === "monitor") return "Monitor";
  return role.charAt(0).toUpperCase() + role.slice(1);
}

interface NavigationProps {
  isCollapsed?: boolean;
  onCollapsedChange?: (isCollapsed: boolean) => void;
}

export function Navigation({
  isCollapsed = false,
  onCollapsedChange = () => {},
}: NavigationProps = {}) {
  const { user, logout } = useAuth();
  const { canAccess, isLoading: accessLoading } = useAccess();
  const router = useRouter();
  const pathname = usePathname();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [linkedinOpen, setLinkedinOpen] = useState(false);
  const [technicalOpen, setTechnicalOpen] = useState(false);

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
  const agentItemKeys = new Set(["dashboard", "leads", "history", "work-queue", "attendance"]);
  const teamLeadItemKeys = new Set(["user-management", "reports", "coaching-notes", "review-queue"]);
  const adminItemKeys = new Set(["branch-management", "hierarchy", "lead-requests", "audit-logs", "settings"]);
  const technicalItemKeys = new Set(["mock", "interview-support", "assessment-support"]);
  const linkedinItemKeys = new Set(["linkedin-requests", "linkedin-account-management", "linkedin-reports"]);

  // Filter items by section
  const agentItems = visibleItems.filter((item) => agentItemKeys.has(item.key));
  const teamLeadItems = visibleItems.filter((item) => teamLeadItemKeys.has(item.key));
  const adminItems = visibleItems.filter((item) => adminItemKeys.has(item.key));
  const technicalItems = visibleItems.filter((item) => technicalItemKeys.has(item.key));
  const linkedinItems = visibleItems.filter((item) => linkedinItemKeys.has(item.key));
  const chatItem = visibleItems.find((item) => item.key === "chat") ?? null;

  // Helper to render a standard nav button
  const renderNavButton = (item: typeof NAV_ITEMS[0]) => {
    const Icon = item.icon;
    const isActive =
      pathname === item.href ||
      (pathname?.startsWith(item.href) && pathname.charAt(item.href.length) === "/");
    return (
      <button
        key={item.key}
        id={`nav-${item.key}`}
        onClick={() => {
          router.push(item.href);
          setMobileMenuOpen(false);
        }}
        className={`nav-item${isActive ? " active" : ""}`}
        title={item.label}
      >
        <Icon size={16} />
        <span className={isCollapsed ? "lg:sr-only" : ""}>{item.label}</span>
      </button>
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
                <button
                  key={item.key}
                  id={`nav-${item.key}`}
                  onClick={() => {
                    router.push(item.href);
                    setMobileMenuOpen(false);
                  }}
                  className={`nav-item${isActive ? " active" : ""}`}
                  title={item.label}
                  style={{ paddingLeft: isCollapsed ? undefined : "1.25rem" }}
                >
                  <ItemIcon size={16} />
                  <span className={isCollapsed ? "lg:sr-only" : ""}>{item.label}</span>
                </button>
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
            { key: "chat-announcement", label: "Announcement", href: "/chat/announcement", icon: Bell },
            { key: "chat-general", label: "General", href: "/chat/general", icon: MessageSquare },
          ].map((item) => {
            const ItemIcon = item.icon;
            const isActive =
              pathname === item.href ||
              (pathname?.startsWith(item.href) && pathname.charAt(item.href.length) === "/");
            return (
              <button
                key={item.key}
                id={`nav-${item.key}`}
                onClick={() => {
                  router.push(item.href);
                  setMobileMenuOpen(false);
                }}
                className={`nav-item${isActive ? " active" : ""}`}
                title={item.label}
                style={{ paddingLeft: isCollapsed ? undefined : "1.25rem" }}
              >
                <ItemIcon size={16} />
                <span className={isCollapsed ? "lg:sr-only" : ""}>{item.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  ) : null;

  const renderedItems: ReactNode[] = [];

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

  // 2. Team Lead Dashboard
  if (teamLeadItems.length > 0) {
    renderedItems.push(
      <div key="section-tl">
        {renderSectionHeader(managementTitle)}
        {teamLeadItems.map(renderNavButton)}
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
                SalesHub CRM
              </h1>
              <p
                style={{
                  fontSize: "0.6875rem",
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                  color: "var(--muted-foreground)",
                  marginTop: "0.1875rem",
                }}>
                Sales Intelligence
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
