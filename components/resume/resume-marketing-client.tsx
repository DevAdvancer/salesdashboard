'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  TrendingUp,
  RefreshCw,
  Search,
  UserCheck,
  ExternalLink,
  Clock,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useAuth } from '@/lib/contexts/auth-context';
import { listMarketingProfilesAction } from '@/app/actions/resume-profiles';
import type { ResumeProfile } from '@/lib/types';

interface ResumeMarketingClientProps {
  initialProfiles: (ResumeProfile & { $id: string })[];
}

export function ResumeMarketingClient({ initialProfiles }: ResumeMarketingClientProps) {
  const router = useRouter();
  const { user, serverSessionReady } = useAuth();
  const [profiles, setProfiles] = useState<(ResumeProfile & { $id: string })[]>(initialProfiles);
  const [searchQuery, setSearchQuery] = useState('');
  const [assignedFilter, setAssignedFilter] = useState<string>('all');

  // Re-fetch client-side once the session is ready — the server component can
  // render before the crm_appwrite_jwt cookie is written. See the
  // serverSessionReady JWT-race pattern used by /linkedin-requests.
  useEffect(() => {
    if (!user || !serverSessionReady) return;
    let cancelled = false;
    void (async () => {
      try {
        const next = await listMarketingProfilesAction();
        if (!cancelled) setProfiles(next);
      } catch {
        // Keep whatever the server component managed to render.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, serverSessionReady]);

  // Assignee options are derived from the profiles on the page — the Marketing
  // view is read-only, so there's no need to fetch the full resume roster.
  const assigneeOptions = useMemo(() => {
    const seen = new Map<string, string>();
    profiles.forEach((p) => {
      if (p.assignedToId && p.assignedToName) {
        seen.set(p.assignedToId, p.assignedToName);
      }
    });
    return Array.from(seen.entries()).map(([id, name]) => ({ id, name }));
  }, [profiles]);

  const filteredProfiles = useMemo(() => {
    return profiles.filter((p) => {
      if (assignedFilter !== 'all') {
        if (assignedFilter === 'unassigned' && p.assignedToId) return false;
        if (assignedFilter !== 'unassigned' && p.assignedToId !== assignedFilter) return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return (
          p.candidateName?.toLowerCase().includes(q) ||
          p.technology?.toLowerCase().includes(q) ||
          p.usaArrival?.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [profiles, assignedFilter, searchQuery]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <TrendingUp className="h-6 w-6 text-primary" />
            Marketing
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Resume profiles that have been moved to Marketing.
          </p>
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={() => router.refresh()}
          className="gap-1.5"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh
        </Button>
      </div>

      <Card className="p-4 bg-card/60 backdrop-blur border border-border shadow-sm">
        <div className="flex flex-col md:flex-row gap-3 items-center justify-between">
          <div className="relative flex-1 w-full md:max-w-xs">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search candidate, tech, USA arrival..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
            <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <UserCheck className="h-3.5 w-3.5" />
              Assigned:
            </div>
            <select
              value={assignedFilter}
              onChange={(e) => setAssignedFilter(e.target.value)}
              className="rounded-md border border-input bg-background px-3 py-1.5 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="all">All Assignees</option>
              <option value="unassigned">Unassigned</option>
              {assigneeOptions.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </Card>

      <Card className="overflow-hidden border border-border shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b bg-muted/50 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                <th className="px-4 py-3">Candidate</th>
                <th className="px-4 py-3">Technology</th>
                <th className="px-4 py-3">USA Arrival</th>
                <th className="px-4 py-3">Visa Status</th>
                <th className="px-4 py-3">Assigned To</th>
                <th className="px-4 py-3">Moved To Marketing</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filteredProfiles.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground text-sm">
                    {profiles.length === 0
                      ? 'No profiles have been moved to Marketing yet.'
                      : 'No profiles match the selected filters.'}
                  </td>
                </tr>
              ) : (
                filteredProfiles.map((p) => {
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
                      <td className="px-4 py-3.5 text-sm text-foreground">
                        {p.assignedToName || (
                          <span className="text-xs italic text-muted-foreground">Unassigned</span>
                        )}
                      </td>
                      <td className="px-4 py-3.5 text-xs text-muted-foreground">
                        <div className="flex items-center gap-1">
                          <Clock className="h-3.5 w-3.5 opacity-70" />
                          {p.marketingMovedAt
                            ? new Date(p.marketingMovedAt).toLocaleDateString([], {
                                month: 'short',
                                day: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit',
                              })
                            : '—'}
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
      </Card>
    </div>
  );
}
