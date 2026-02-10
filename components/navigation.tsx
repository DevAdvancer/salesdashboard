'use client';

import { useAuth } from '@/lib/contexts/auth-context';
import { useAccess, ComponentKey } from '@/lib/contexts/access-control-context';
import { useRouter, usePathname } from 'next/navigation';
import { Button } from '@/components/ui/button';
import {
  LayoutDashboard,
  Building2,
  Users,
  FileText,
  History,
  Settings,
  FormInput,
  LogOut,
  Menu,
  X,
} from 'lucide-react';
import { useState } from 'react';

interface NavItem {
  key: string;
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
}

const NAV_ITEMS: NavItem[] = [
  {
    key: 'dashboard',
    label: 'Dashboard',
    href: '/dashboard',
    icon: LayoutDashboard,
  },
  {
    key: 'branch-management',
    label: 'Branches',
    href: '/branches',
    icon: Building2,
  },
  {
    key: 'leads',
    label: 'Leads',
    href: '/leads',
    icon: FileText,
  },
  {
    key: 'history',
    label: 'History',
    href: '/history',
    icon: History,
  },
  {
    key: 'user-management',
    label: 'User Management',
    href: '/users',
    icon: Users,
  },
  {
    key: 'field-management',
    label: 'Field Management',
    href: '/field-management',
    icon: FormInput,
  },
  {
    key: 'settings',
    label: 'Settings',
    href: '/settings/access',
    icon: Settings,
  },
];

export function Navigation() {
  const { user, logout } = useAuth();
  const { canAccess } = useAccess();
  const router = useRouter();
  const pathname = usePathname();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const handleLogout = async () => {
    try {
      await logout();
      router.push('/login');
    } catch (error) {
      console.error('Logout error:', error);
    }
  };

  if (!user) {
    return null;
  }

  const visibleItems = NAV_ITEMS.filter((item) =>
    canAccess(item.key as ComponentKey)
  );

  const NavLinks = () => (
    <>
      {visibleItems.map((item) => {
        const Icon = item.icon;
        const isActive = pathname === item.href;

        return (
          <button
            key={item.key}
            onClick={() => {
              router.push(item.href);
              setMobileMenuOpen(false);
            }}
            className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-colors w-full text-left ${
              isActive
                ? 'bg-primary text-primary-foreground'
                : 'hover:bg-accent hover:text-accent-foreground'
            }`}
          >
            <Icon className="h-5 w-5" />
            <span>{item.label}</span>
          </button>
        );
      })}
    </>
  );

  return (
    <>
      {/* Mobile menu button */}
      <div className="lg:hidden fixed top-3 left-3 z-50">
        <Button
          variant="outline"
          size="icon"
          className="h-10 w-10 shadow-md"
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
        >
          {mobileMenuOpen ? (
            <X className="h-5 w-5" />
          ) : (
            <Menu className="h-5 w-5" />
          )}
        </Button>
      </div>

      {/* Mobile menu overlay */}
      {mobileMenuOpen && (
        <div
          className="lg:hidden fixed inset-0 bg-black/50 z-40"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed top-0 left-0 h-full w-64 bg-card border-r border-border flex flex-col z-40 transition-transform lg:translate-x-0 ${
          mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Header */}
        <div className="p-6 border-b border-border">
          <h1 className="text-xl font-bold">SalesHub CRM</h1>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-4 space-y-2 overflow-y-auto">
          <NavLinks />
        </nav>

        {/* User info and logout */}
        <div className="p-4 border-t border-border space-y-3">
          <div className="px-4 py-2">
            <p className="text-sm font-medium truncate">{user.name}</p>
            <p className="text-xs text-muted-foreground capitalize">
              {user.role}
            </p>
          </div>
          <Button
            variant="outline"
            className="w-full"
            onClick={handleLogout}
          >
            <LogOut className="h-4 w-4 mr-2" />
            Log out
          </Button>
        </div>
      </aside>
    </>
  );
}
