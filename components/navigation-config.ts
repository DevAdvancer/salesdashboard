import type { ComponentType } from 'react';
import {
  Briefcase,
  Building2,
  ClipboardCheck,
  ClipboardList,
  FileText,
  FormInput,
  LayoutDashboard,
  Mail,
  Network,
  Settings,
  Users,
  Video,
} from 'lucide-react';

export type AppIcon = ComponentType<{ className?: string; size?: number }>;

export interface NavItem {
  key: string;
  label: string;
  href: string;
  icon: AppIcon;
}

export const appIcons = {
  dashboard: LayoutDashboard,
  branches: Building2,
  leads: FileText,
  clients: Briefcase,
  mock: Mail,
  assessmentSupport: ClipboardCheck,
  interviewSupport: Video,
  hierarchy: Network,
  users: Users,
  fieldManagement: FormInput,
  auditLogs: ClipboardList,
  settings: Settings,
} satisfies Record<string, AppIcon>;

export const NAV_ITEMS: NavItem[] = [
  { key: 'dashboard', label: 'Dashboard', href: '/dashboard', icon: appIcons.dashboard },
  { key: 'branch-management', label: 'Branches', href: '/branches', icon: appIcons.branches },
  { key: 'leads', label: 'Leads', href: '/leads', icon: appIcons.leads },
  { key: 'history', label: 'Client', href: '/client', icon: appIcons.clients },
  { key: 'mock', label: 'Mock Interview', href: '/mock', icon: appIcons.mock },
  { key: 'assessment-support', label: 'Assessment', href: '/assessment-support', icon: appIcons.assessmentSupport },
  { key: 'interview-support', label: 'Interview Support', href: '/interview-support', icon: appIcons.interviewSupport },
  { key: 'hierarchy', label: 'Hierarchy', href: '/hierarchy', icon: appIcons.hierarchy },
  { key: 'user-management', label: 'Users', href: '/users', icon: appIcons.users },
  { key: 'field-management', label: 'Field Management', href: '/field-management', icon: appIcons.fieldManagement },
  { key: 'audit-logs', label: 'Audit Logs', href: '/audit-logs', icon: appIcons.auditLogs },
  { key: 'settings', label: 'Settings', href: '/settings', icon: appIcons.settings },
];
