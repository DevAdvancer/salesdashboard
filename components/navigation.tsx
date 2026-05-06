'use client';

import { useAuth } from '@/lib/contexts/auth-context';
import { useAccess, ComponentKey } from '@/lib/contexts/access-control-context';
import { useRouter, usePathname } from 'next/navigation';
import { LogOut, Menu, PanelLeftClose, PanelLeftOpen, X } from 'lucide-react';
import { useState } from 'react';
import { NAV_ITEMS } from './navigation-config';

function formatRoleLabel(role: string): string {
  if (role === 'team_lead') return 'Team Lead';
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
        className={`fixed top-0 left-0 h-full w-64 flex flex-col z-40 transition-[width,transform] duration-300 lg:translate-x-0 ${isCollapsed ? 'sidebar-collapsed lg:w-20' : 'lg:w-64'} ${mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'}`}
        style={{
          background: 'var(--sidebar)',
          borderRight: '1px solid var(--border)',
        }}
      >
        {/* Brand */}
        <div
          className={`flex items-start border-b border-border p-5 ${isCollapsed ? 'lg:items-center lg:justify-center lg:p-3' : ''}`}
        >
          <div className={`min-w-0 flex-1 ${isCollapsed ? 'lg:hidden' : ''}`}>
            <div className="brand-accent-bar" style={{ marginBottom: '0.625rem' }} />
            <div className={isCollapsed ? 'lg:sr-only' : ''}>
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
          </div>

          <button
            type="button"
            aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-pressed={isCollapsed}
            title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            onClick={() => onCollapsedChange(!isCollapsed)}
            className="hidden lg:flex size-9 shrink-0 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            {isCollapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
          </button>
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
                  title={item.label}
                >
                  <Icon size={16} />
                  <span className={isCollapsed ? 'lg:sr-only' : ''}>{item.label}</span>
                </button>
              );
            })}
          </div>
        </nav>

        {/* User */}
        <div style={{ padding: '0.75rem', borderTop: '1px solid var(--border)' }}>
          <div
            className={isCollapsed ? 'lg:justify-center' : ''}
            style={{
              display: 'flex', alignItems: 'center', gap: '0.625rem',
              padding: '0.5rem 0.625rem',
              borderRadius: '0.5rem',
              background: 'var(--surface-2)',
              marginBottom: '0.375rem',
            }}
            title={`${user.name} - ${formatRoleLabel(user.role)}`}
          >
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
            <div className={isCollapsed ? 'lg:sr-only' : ''} style={{ minWidth: 0, flex: 1 }}>
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
            title="Sign out"
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
            <span className={isCollapsed ? 'lg:sr-only' : ''}>Sign out</span>
          </button>
        </div>
      </aside>
    </>
  );
}
