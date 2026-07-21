'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  FileText,
  Filter,
  Plus,
  RefreshCw,
  Search,
  UserCheck,
  ExternalLink,
  Clock,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { TableSkeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/lib/contexts/auth-context';
import {
  RESUME_PROFILE_STAGES,
  type CallRequest,
  type ResumeProfile,
} from '@/lib/types';
import {
  updateResumeProfileAction,
  listResumeProfilesAction,
  getResumeProfileOptionsAction,
} from '@/app/actions/resume-profiles';
import { useRealtimeCollection } from "@/lib/hooks/use-realtime-collection";
import { COLLECTIONS } from "@/lib/appwrite";

interface ResumeProfilesClientProps {
  initialData: { documents: (ResumeProfile & { $id: string })[]; total: number };
  initialOptions: {
    assignableUsers: { $id: string; name: string; email: string }[];
  };
  currentPage: number;
}

const STAGE_BADGE: Record<string, string> = {
  '1. Draft': 'bg-secondary text-secondary-foreground border border-border',
  '2. Sent': 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300 border border-blue-200 dark:border-blue-800',
  '3. Modification /Approval (candidate/client)':
    'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 border border-amber-200 dark:border-amber-800',
  '4. Marketing':
    'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800',
  '5. Doc Missing (Not calculated in the timeline)':
    'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300 border border-red-200 dark:border-red-800',
};

export function ResumeProfilesClient({
  initialData,
  initialOptions,
  currentPage,
}: ResumeProfilesClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useAuth();
  
  const [profiles, setProfiles] = useState<(ResumeProfile & { $id: string })[]>(initialData.documents);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Sync state when props change from server component
  useEffect(() => {
    setProfiles(initialData.documents);
  }, [initialData.documents]);

  useRealtimeCollection(COLLECTIONS.RESUME_PROFILES, () => {
    router.refresh();
  });

  const updateSearchParam = (key: string, value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value && value !== 'all') {
      params.set(key, value);
    } else {
      params.delete(key);
    }
    // reset page to 1 when filters change
    if (key !== 'page') {
      params.set('page', '1');
    }
    router.push(`?${params.toString()}`);
  };

  const [searchQuery, setSearchQuery] = useState(searchParams.get('search') || '');
  const stageFilter = searchParams.get('stage') || 'all';
  const assignedFilter = searchParams.get('assignedToId') || 'all';

  const isLeadership =
    user?.role === 'admin' ||
    user?.role === 'developer' ||
    user?.role === 'monitor' ||
    user?.role === 'operations';
  const canExplicitlyCreate = user?.role === 'team_lead' || isLeadership;

  const handleQuickStageChange = async (profileId: string, newStage: string) => {
    setBusyId(profileId);
    try {
      const updated = await updateResumeProfileAction({
        $id: profileId,
        stage: newStage,
      });
      setProfiles((prev) =>
        prev.map((p) => (p.$id === profileId ? { ...p, ...updated } : p))
      );
    } catch (err: any) {
      alert(err?.message || 'Failed to update stage');
    } finally {
      setBusyId(null);
    }
  };

  const formatStageLabel = (stage: string) => {
    if (stage.startsWith('3.')) return '3. Mod / Approval';
    if (stage.startsWith('5.')) return '5. Doc Missing';
    return stage;
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <FileText className="h-6 w-6 text-primary" />
            Resume Profiles
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Track resume stages, work authorization details, and timeline SLAs.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => router.refresh()}
            className="gap-1.5"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </Button>
          {canExplicitlyCreate && (
            <Link href="/resume/new">
              <Button
                size="sm"
                className="gap-1.5 bg-primary text-primary-foreground shadow-sm hover:bg-primary/90"
              >
                <Plus className="h-4 w-4" />
                Create Profile
              </Button>
            </Link>
          )}
        </div>
      </div>

      {/* Top Filters Bar */}
      <Card className="p-4 bg-card/60 backdrop-blur border border-border shadow-sm">
        <div className="flex flex-col md:flex-row gap-3 items-center justify-between">
          <div className="relative flex-1 w-full md:max-w-xs">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search candidate (press Enter)..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  updateSearchParam('search', searchQuery);
                }
              }}
              className="w-full pl-9 pr-3 py-2 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
            <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Filter className="h-3.5 w-3.5" />
              Stage:
            </div>
            <select
              value={stageFilter}
              onChange={(e) => updateSearchParam('stage', e.target.value)}
              className="rounded-md border border-input bg-background pl-3 pr-8 py-1.5 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="all">All Stages</option>
              {RESUME_PROFILE_STAGES.map((st) => (
                <option key={st} value={st}>
                  {formatStageLabel(st)}
                </option>
              ))}
            </select>

            {user?.role !== 'agent' && (
              <>
                <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground ml-2">
                  <UserCheck className="h-3.5 w-3.5" />
                  Assigned:
                </div>
                <select
                  value={assignedFilter}
                  onChange={(e) => updateSearchParam('assignedToId', e.target.value)}
                  className="rounded-md border border-input bg-background pl-3 pr-8 py-1.5 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  <option value="all">All Assignees</option>
                  {initialOptions.assignableUsers.map((u) => (
                    <option key={u.$id} value={u.$id}>
                      {u.name}
                    </option>
                  ))}
                </select>
              </>
            )}
          </div>
        </div>
      </Card>

      {/* Profiles Table */}
      <Card className="overflow-hidden border border-border shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b bg-muted/50 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                <th className="px-4 py-3">Candidate</th>
                <th className="px-4 py-3">Stage</th>
                <th className="px-4 py-3">Technology</th>
                <th className="px-4 py-3">USA Arrival</th>
                <th className="px-4 py-3">Visa Status</th>
                {user?.role !== 'agent' && <th className="px-4 py-3">Assigned To</th>}
                <th className="px-4 py-3">Stage Updated</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {profiles.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-muted-foreground text-sm">
                    {initialData.total === 0
                      ? 'No resume profiles found. Click "Create Profile" to get started.'
                      : 'No profiles match the selected filters.'}
                  </td>
                </tr>
              ) : (
                profiles.map((p) => {
                  const badgeClass =
                    STAGE_BADGE[p.stage] ?? 'bg-secondary text-secondary-foreground border border-border';
                  const isBusy = busyId === p.$id;

                  const hasCpt = p.cpt?.toUpperCase() === 'YES';
                  const hasOpt = p.opt?.toUpperCase() === 'YES';
                  const hasStem = p.stemOpt?.toUpperCase() === 'YES';

                  return (
                    <tr key={p.$id} className="hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-3.5 font-medium text-foreground">
                        <Link
                          href={`/resume/${p.$id}`}
                          className="hover:underline text-primary font-semibold flex items-center gap-1.5"
                        >
                          {p.candidateName}
                          <ExternalLink className="h-3.5 w-3.5 opacity-70" />
                        </Link>
                      </td>
                      <td className="px-4 py-3.5">
                        <select
                          disabled={isBusy}
                          value={p.stage}
                          onChange={(e) => handleQuickStageChange(p.$id, e.target.value)}
                          className={`rounded-full px-2.5 py-1 text-xs font-semibold focus:outline-none cursor-pointer border ${badgeClass}`}
                        >
                          {RESUME_PROFILE_STAGES.map((st) => (
                            <option
                              key={st}
                              value={st}
                              className="bg-background text-foreground text-xs"
                            >
                              {formatStageLabel(st)}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-4 py-3.5 text-muted-foreground">
                        {p.technology || '—'}
                      </td>
                      <td className="px-4 py-3.5 text-muted-foreground">
                        {p.usaArrival || '—'}
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="flex flex-wrap gap-1">
                          {hasCpt && (
                            <span className="inline-flex items-center rounded-md bg-purple-100 dark:bg-purple-900/40 px-2 py-0.5 text-[10px] font-semibold text-purple-800 dark:text-purple-300 border border-purple-200 dark:border-purple-800">
                              CPT
                            </span>
                          )}
                          {hasOpt && (
                            <span className="inline-flex items-center rounded-md bg-cyan-100 dark:bg-cyan-900/40 px-2 py-0.5 text-[10px] font-semibold text-cyan-800 dark:text-cyan-300 border border-cyan-200 dark:border-cyan-800">
                              OPT
                            </span>
                          )}
                          {hasStem && (
                            <span className="inline-flex items-center rounded-md bg-indigo-100 dark:bg-indigo-900/40 px-2 py-0.5 text-[10px] font-semibold text-indigo-800 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
                              STEM OPT
                            </span>
                          )}
                          {!hasCpt && !hasOpt && !hasStem && (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </div>
                      </td>
                      {user?.role !== 'agent' && (
                        <td className="px-4 py-3.5 text-sm text-foreground">
                          {p.assignedToName || (
                            <span className="text-xs italic text-muted-foreground">Unassigned</span>
                          )}
                        </td>
                      )}
                      <td className="px-4 py-3.5 text-xs text-muted-foreground">
                        <div className="flex items-center gap-1">
                          <Clock className="h-3.5 w-3.5 opacity-70" />
                          {p.stageUpdatedAt
                            ? new Date(p.stageUpdatedAt).toLocaleDateString([], {
                                month: 'short',
                                day: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit',
                              })
                            : new Date(p.createdAt).toLocaleDateString([], {
                                month: 'short',
                                day: 'numeric',
                              })}
                        </div>
                      </td>
                      <td className="px-4 py-3.5 text-right">
                        <Link href={`/resume/${p.$id}`}>
                          <Button variant="outline" size="sm" className="h-7 px-2.5 text-xs">
                            Open Profile
                          </Button>
                        </Link>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        
        {/* Pagination Footer */}
        {initialData.total > 0 && (
          <div className="flex items-center justify-between px-4 py-3 border-t bg-muted/20">
            <span className="text-sm text-muted-foreground">
              Showing {profiles.length} of {initialData.total} profiles
            </span>
            <div className="flex gap-2">
              <Button 
                variant="outline" 
                size="sm" 
                disabled={currentPage <= 1}
                onClick={() => updateSearchParam('page', String(currentPage - 1))}
              >
                Previous
              </Button>
              <Button 
                variant="outline" 
                size="sm"
                disabled={currentPage >= Math.ceil(initialData.total / 50)}
                onClick={() => updateSearchParam('page', String(currentPage + 1))}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </Card>

    </div>
  );
}
