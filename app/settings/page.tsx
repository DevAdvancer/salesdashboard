'use client';

import { useEffect, useState } from 'react';
import { Info, Lock, Moon, ShieldCheck, Sun, UserRound } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { updateOwnProfileAction } from '@/app/actions/profile';
import { ProtectedRoute } from '@/components/protected-route';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/use-toast';
import { account, databases, DATABASE_ID, COLLECTIONS } from '@/lib/appwrite';
import { useAuth } from '@/lib/contexts/auth-context';
import { listBranches } from '@/lib/services/branch-service';
import type { UserRole } from '@/lib/types';

function formatRoleLabel(role: UserRole) {
  if (role === 'team_lead') return 'Team Lead';
  if (role === 'lead_generation') return 'Lead Generation';
  if (role === 'operations') return 'Operations';
  return role.charAt(0).toUpperCase() + role.slice(1);
}

// Bump this string every time you ship a new release. It is shown on the
// Settings page so users can confirm which build they are running.
const APP_VERSION = '3.5';

export default function SettingsPage() {
  return (
    <ProtectedRoute componentKey="settings">
      <SettingsContent />
    </ProtectedRoute>
  );
}

function SettingsContent() {
  const router = useRouter();
  const { user } = useAuth();
  const { toast } = useToast();
  const [name, setName] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [branchNames, setBranchNames] = useState<string[]>([]);
  const [teamLeadName, setTeamLeadName] = useState<string | null>(null);
  const [theme, setTheme] = useState<'light' | 'dark'>('light');

  useEffect(() => {
    const savedTheme = localStorage.getItem('salesdashboard-theme') === 'dark' ? 'dark' : 'light';
    setTheme(savedTheme);
    document.documentElement.classList.toggle('dark', savedTheme === 'dark');
    document.documentElement.style.colorScheme = savedTheme;
  }, []);

  const updateTheme = (nextTheme: 'light' | 'dark') => {
    setTheme(nextTheme);
    localStorage.setItem('salesdashboard-theme', nextTheme);
    document.documentElement.classList.toggle('dark', nextTheme === 'dark');
    document.documentElement.style.colorScheme = nextTheme;
    toast({
      title: `${nextTheme === 'dark' ? 'Dark' : 'Light'} theme saved`,
      description: 'Your dashboard will use this theme next time you sign in.',
    });
  };

  useEffect(() => {
    if (user) {
      setName(user.name ?? '');
    }
  }, [user]);

  // Resolve branch IDs to branch names
  useEffect(() => {
    async function resolveBranches() {
      if (!user?.branchIds?.length) return;
      try {
        const allBranches = await listBranches();
        const branchMap = new Map(allBranches.map((b) => [b.$id, b.name]));
        const names = user.branchIds
          .map((id) => branchMap.get(id) || id)
          .filter(Boolean);
        setBranchNames(names);
      } catch {
        // fallback: show IDs
        setBranchNames(user.branchIds);
      }
    }
    resolveBranches();
  }, [user]);

  // Resolve team lead ID to name
  useEffect(() => {
    async function resolveTeamLead() {
      if (!user?.teamLeadId) return;
      try {
        const doc = await databases.getDocument(
          DATABASE_ID,
          COLLECTIONS.USERS,
          user.teamLeadId
        );
        setTeamLeadName(typeof doc.name === 'string' ? doc.name : null);
      } catch {
        setTeamLeadName(null);
      }
    }
    resolveTeamLead();
  }, [user]);

  if (!user) {
    return <SettingsSkeleton />;
  }

  const canManageAccess = user.role === 'admin';

  const saveProfile = async () => {
    if (!name.trim()) return;
    try {
      setSavingProfile(true);
      await updateOwnProfileAction({
        currentUserId: user.$id,
        name,
      });
      toast({ title: 'Profile updated' });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unable to update your profile.';
      console.error('Failed to update profile:', error);
      toast({
        title: 'Error',
        description: message,
        variant: 'destructive',
      });
    } finally {
      setSavingProfile(false);
    }
  };

  const changePassword = async () => {
    if (!currentPassword || !newPassword || newPassword !== confirmPassword) return;
    try {
      setSavingPassword(true);
      await account.updatePassword(newPassword, currentPassword);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      toast({ title: 'Password updated' });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unable to update your password.';
      console.error('Failed to update password:', error);
      toast({
        title: 'Error',
        description: message,
        variant: 'destructive',
      });
    } finally {
      setSavingPassword(false);
    }
  };

  return (
    <div className="container mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold md:text-3xl">Settings</h1>
        <p className="text-muted-foreground">Profile, security, and account details for your CRM user.</p>
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <UserRound className="h-4 w-4" />
              Profile
            </CardTitle>
            <CardDescription>Keep your display name current across dashboard activity and notes.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <Label htmlFor="profile-name">Name</Label>
                <Input
                  id="profile-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Your name"
                />
              </div>
              <div>
                <Label htmlFor="profile-email">Email</Label>
                <Input id="profile-email" value={user.email} readOnly />
              </div>
            </div>
            <Button onClick={saveProfile} loading={savingProfile} disabled={!name.trim()}>
              Save Profile
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4" />
              Role Scope
            </CardTitle>
            <CardDescription>Your current permissions are based on this role and assignment.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
              <span className="text-muted-foreground">Role</span>
              <span className="font-medium">{formatRoleLabel(user.role)}</span>
            </div>
            <div className="rounded-md border border-border px-3 py-2">
              <p className="text-muted-foreground">Branches</p>
              <p className="mt-1 font-medium">
                {branchNames.length ? branchNames.join(', ') : (user.branchIds?.length ? 'Loading...' : 'Not assigned')}
              </p>
            </div>
            {user.teamLeadId && (
              <div className="rounded-md border border-border px-3 py-2">
                <p className="text-muted-foreground">Team Lead</p>
                <p className="mt-1 font-medium">{teamLeadName ?? 'Loading...'}</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Lock className="h-4 w-4" />
              Security
            </CardTitle>
            <CardDescription>Change your password without changing your CRM role or branch assignment.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-3">
              <div>
                <Label htmlFor="current-password">Current Password</Label>
                <Input
                  id="current-password"
                  type="password"
                  value={currentPassword}
                  onChange={(event) => setCurrentPassword(event.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="new-password">New Password</Label>
                <Input
                  id="new-password"
                  type="password"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="confirm-password">Confirm Password</Label>
                <Input
                  id="confirm-password"
                  type="password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                />
              </div>
            </div>
            {newPassword && confirmPassword && newPassword !== confirmPassword && (
              <p className="text-sm text-destructive">New password and confirmation do not match.</p>
            )}
            <Button
              onClick={changePassword}
              loading={savingPassword}
              disabled={!currentPassword || !newPassword || newPassword !== confirmPassword}
            >
              Update Password
            </Button>
          </CardContent>
        </Card>

        {canManageAccess && (
          <Card>
            <CardHeader>
              <CardTitle>Access Control</CardTitle>
              <CardDescription>Manage feature visibility for roles that are allowed to use each module.</CardDescription>
            </CardHeader>
            <CardContent>
              <Button variant="outline" className="w-full" onClick={() => router.push('/settings/access')}>
                Open Access Control
              </Button>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Appearance</CardTitle>
            <CardDescription>Choose the dashboard theme saved on this device.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-2 rounded-[1.5rem] bg-[var(--soft-cloud)] p-1">
              <button
                type="button"
                onClick={() => updateTheme('light')}
                aria-pressed={theme === 'light'}
                className={`flex h-11 items-center justify-center gap-2 rounded-full text-sm font-medium transition-colors ${
                  theme === 'light'
                    ? 'bg-[var(--ink)] text-[var(--canvas)]'
                    : 'text-[var(--mute)] hover:text-[var(--ink)]'
                }`}
              >
                <Sun className="h-4 w-4" />
                Light
              </button>
              <button
                type="button"
                onClick={() => updateTheme('dark')}
                aria-pressed={theme === 'dark'}
                className={`flex h-11 items-center justify-center gap-2 rounded-full text-sm font-medium transition-colors ${
                  theme === 'dark'
                    ? 'bg-[var(--ink)] text-[var(--canvas)]'
                    : 'text-[var(--mute)] hover:text-[var(--ink)]'
                }`}
              >
                <Moon className="h-4 w-4" />
                Dark
              </button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Info className="h-4 w-4" />
              About
            </CardTitle>
            <CardDescription>Build information for the CRM you are running.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
              <span className="text-muted-foreground">Version</span>
              <span
                className="inline-flex items-center rounded-full bg-[var(--soft-cloud)] px-3 py-1 text-xs font-medium"
                aria-label={`Current version ${APP_VERSION}`}>
                v{APP_VERSION}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              You are currently running version {APP_VERSION} of SalesHub CRM.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function SettingsSkeleton() {
  return (
    <div className="container mx-auto space-y-6">
      <div>
        <Skeleton className="h-9 w-48" />
        <Skeleton className="mt-3 h-4 w-80" />
      </div>
      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader>
            <Skeleton className="h-6 w-32" />
            <Skeleton className="h-4 w-72" />
          </CardHeader>
          <CardContent className="space-y-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-32" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <Skeleton className="h-6 w-32" />
          </CardHeader>
          <CardContent className="space-y-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-16 w-full" />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
