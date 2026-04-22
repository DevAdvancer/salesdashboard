'use client';

import { useAuth } from '@/lib/contexts/auth-context';
import { useAccess, ComponentKey } from '@/lib/contexts/access-control-context';
import { useRouter, usePathname } from 'next/navigation';
import {
  LayoutDashboard, Building2, Users, FileText, Briefcase,
  Settings, FormInput, LogOut, Menu, X, ClipboardList,
  Mail, ClipboardCheck, Video, Network,
} from 'lucide-react';
import { useState } from 'react';

function formatRoleLabel(role: string): string {
  if (role === 'team_lead') return 'Team Lead';
  return role.charAt(0).toUpperCase() + role.slice(1);
}

interface NavItem {
  key: string;
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string; size?: number }>;
}

const NAV_ITEMS: NavItem[] = [
  { key: 'dashboard',          label: 'Dashboard',          href: '/dashboard',          icon: LayoutDashboard },
  { key: 'branch-management',  label: 'Branches',           href: '/branches',           icon: Building2 },
  { key: 'leads',              label: 'Leads',              href: '/leads',              icon: FileText },
  { key: 'history',            label: 'Client',             href: '/client',             icon: Briefcase },
  { key: 'mock',               label: 'Mock Interview',     href: '/mock',               icon: Mail },
  { key: 'assessment-support', label: 'Assessment',         href: '/assessment-support', icon: ClipboardCheck },
  { key: 'interview-support',  label: 'Interview Support',  href: '/interview-support',  icon: Video },
  { key: 'hierarchy',          label: 'Hierarchy',          href: '/hierarchy',          icon: Network },
  { key: 'user-management',    label: 'Users',              href: '/users',              icon: Users },
  { key: 'field-management',   label: 'Field Management',   href: '/field-management',   icon: FormInput },
  { key: 'audit-logs',         label: 'Audit Logs',         href: '/audit-logs',         icon: ClipboardList },
  { key: 'settings',           label: 'Settings',           href: '/settings',           icon: Settings },
];

export function Navigation() {
  const { user, logout } = useAuth();
  const { canAccess } = useAccess();
  const router = useRouter();
  const pathname = usePathname();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const handleLogout = async () => {
    try { await logout(); router.push('/login'); }
    catch (e) { console.error('Logout error:', e); }
  };

  if (!user) return null;

  const visibleItems = NAV_ITEMS.filter(item => canAccess(item.key as ComponentKey));

  return (
    <>
      {/* ── Mobile toggle ── */}
      <div className="lg:hidden fixed top-3 left-3 z-50">
        <button
          id="mobile-menu-toggle"
          onClick={() => setMobileMenuOpen(v => !v)}
          style={{
            width: '2.5rem', height: '2.5rem',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            borderRadius: '0.5rem',
            background: 'var(--surface-1)',
            border: '1px solid var(--border)',
            color: 'var(--muted-foreground)',
            cursor: 'pointer',
            transition: 'background 0.12s ease, color 0.12s ease',
          }}
        >
          {mobileMenuOpen ? <X size={18} /> : <Menu size={18} />}
        </button>
      </div>

      {/* ── Mobile backdrop ── */}
      {mobileMenuOpen && (
        <div
          onClick={() => setMobileMenuOpen(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 40,
            background: 'rgba(15,15,14,0.60)',
            backdropFilter: 'blur(4px)',
          }}
        />
      )}

      {/* ── Sidebar ── */}
      <aside
        className={`fixed top-0 left-0 h-full w-64 flex flex-col z-40 transition-transform duration-300 lg:translate-x-0 ${mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'}`}
        style={{
          background: 'var(--sidebar)',
          borderRight: '1px solid var(--border)',
        }}
      >
        {/* Brand */}
        <div style={{ padding: '1.25rem', borderBottom: '1px solid var(--border)' }}>
          <div className="brand-accent-bar" style={{ marginBottom: '0.625rem' }} />
          <h1 style={{
            fontFamily: "'Playfair Display', Georgia, serif",
            fontWeight: 500, fontSize: '1.1875rem',
            color: 'var(--foreground)', lineHeight: 1.20, margin: 0,
          }}>
            SalesHub CRM
          </h1>
          <p style={{
            fontSize: '0.6875rem', letterSpacing: '0.06em', textTransform: 'uppercase',
            color: 'var(--muted-foreground)', marginTop: '0.1875rem',
          }}>
            Sales Intelligence
          </p>
        </div>

        {/* Nav links */}
        <nav style={{ flex: 1, padding: '0.625rem', overflowY: 'auto' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
            {visibleItems.map(item => {
              const Icon = item.icon;
              const isActive =
                pathname === item.href ||
                (pathname?.startsWith(item.href) && pathname.charAt(item.href.length) === '/');
              return (
                <button
                  key={item.key}
                  id={`nav-${item.key}`}
                  onClick={() => { router.push(item.href); setMobileMenuOpen(false); }}
                  className={`nav-item${isActive ? ' active' : ''}`}
                >
                  <Icon size={16} />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>
        </nav>

        {/* User */}
        <div style={{ padding: '0.75rem', borderTop: '1px solid var(--border)' }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: '0.625rem',
            padding: '0.5rem 0.625rem',
            borderRadius: '0.5rem',
            background: 'var(--surface-2)',
            marginBottom: '0.375rem',
          }}>
            {/* Avatar */}
            <div style={{
              width: '2rem', height: '2rem', borderRadius: '50%', flexShrink: 0,
              background: 'rgba(201,100,66,0.18)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <span style={{
                fontSize: '0.8125rem', fontWeight: 600,
                color: '#d97757',
                fontFamily: "'Playfair Display', Georgia, serif",
              }}>
                {user.name?.charAt(0).toUpperCase() ?? 'U'}
              </span>
            </div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <p style={{
                fontSize: '0.8125rem', fontWeight: 500,
                color: 'var(--foreground)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                margin: 0, lineHeight: 1.30,
              }}>
                {user.name}
              </p>
              <p style={{ fontSize: '0.6875rem', color: 'var(--muted-foreground)', margin: 0 }}>
                {formatRoleLabel(user.role)}
              </p>
            </div>
          </div>

          <button
            onClick={handleLogout}
            style={{
              display: 'flex', alignItems: 'center', gap: '0.5rem',
              width: '100%', padding: '0.4375rem 0.625rem',
              borderRadius: '0.5rem', border: 'none',
              background: 'transparent',
              fontSize: '0.875rem', color: 'var(--muted-foreground)',
              cursor: 'pointer',
              transition: 'background 0.12s ease, color 0.12s ease',
            }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLButtonElement).style.background = 'rgba(181,51,51,0.10)';
              (e.currentTarget as HTMLButtonElement).style.color = '#c0392b';
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
              (e.currentTarget as HTMLButtonElement).style.color = 'var(--muted-foreground)';
            }}
          >
            <LogOut size={14} />
            <span>Sign out</span>
          </button>
        </div>
      </aside>
    </>
  );
}
