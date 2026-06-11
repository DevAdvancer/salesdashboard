'use client';

import { useEffect, useState, type CSSProperties } from 'react';
import { useAuth } from '@/lib/contexts/auth-context';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Spinner } from '@/components/ui/spinner';
import { getAuditLogs } from '@/lib/services/audit-service';
import { AuditLog } from '@/lib/types';
import { RefreshCw, User as UserIcon, Eye, Filter } from 'lucide-react';
import { ProtectedRoute } from '@/components/protected-route';
import { databases, DATABASE_ID, COLLECTIONS } from '@/lib/appwrite';
import { listBranches } from '@/lib/services/branch-service';
import { buildAuditLogDetailModel, type AuditLogDetailModel } from '@/lib/utils/audit-log-details';
import { Query } from 'appwrite';
import { Label } from '@/components/ui/label';
import { DatePicker } from '@/components/ui/date-picker';

// Action types for filtering
const AUDIT_ACTIONS = [
  'USER_CREATE', 'USER_UPDATE', 'USER_DELETE',
  'LEAD_CREATE', 'LEAD_UPDATE', 'LEAD_DELETE', 'LEAD_CLOSE', 'LEAD_REOPEN',
  'LOGIN', 'LOGOUT',
  'MOCK_EMAIL_SENT', 'INTERVIEW_EMAIL_SENT', 'ASSESSMENT_EMAIL_SENT',
  'LINKEDIN_REQUEST_CREATE', 'LINKEDIN_REQUEST_ACCEPT', 'LINKEDIN_REQUEST_WITHDRAW', 'LINKEDIN_REQUEST_LINK_LEAD',
  'FORM_CONFIG_UPDATE', 'SETTINGS_UPDATE',
  'BRANCH_CREATE', 'BRANCH_UPDATE',
];

// Target types for filtering
const AUDIT_TARGET_TYPES = [
  'USER', 'LEAD', 'LINKEDIN_REQUEST', 'LINKEDIN_ACCOUNT',
  'FORM_CONFIG', 'SETTINGS', 'BRANCH'
];

type MetadataRecord = Record<string, unknown>;

interface FormAuditField {
  key: string;
  label: string;
  type?: string;
}

interface FormAuditChange {
  from: unknown;
  to: unknown;
}

interface FormAuditModifiedField {
  key: string;
  label: string;
  changes: Record<string, FormAuditChange>;
}

function parseLeadNameFromData(data: unknown): string | null {
  if (typeof data !== 'string') return null;

  try {
    const parsed = JSON.parse(data) as Record<string, unknown>;
    const firstName = typeof parsed.firstName === 'string' ? parsed.firstName : '';
    const lastName = typeof parsed.lastName === 'string' ? parsed.lastName : '';
    const fullName = [firstName, lastName].filter(Boolean).join(' ').trim();
    const fallback = parsed.legalName || parsed.name || parsed.company || parsed.email || parsed.phone;
    return fullName || (typeof fallback === 'string' ? fallback : null);
  } catch {
    return null;
  }
}

function getString(value: unknown, fallback = 'N/A'): string {
  return typeof value === 'string' && value.trim() ? value : fallback;
}

function AuditLogsContent() {
  const { user, isAdmin, isMonitor } = useAuth();
  const canReadAuditLogs = isAdmin || isMonitor;
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedLog, setSelectedLog] = useState<AuditLog | null>(null);
  const [idToNameMap, setIdToNameMap] = useState<Map<string, string>>(new Map());
  const [currentPage, setCurrentPage] = useState(1);
  const ITEMS_PER_PAGE = 10;
  const router = useRouter();

  // Filter state
  const [filterAction, setFilterAction] = useState<string>('');
  const [filterTargetType, setFilterTargetType] = useState<string>('');
  const [filterActorId, setFilterActorId] = useState<string>('');
  const [filterDateFrom, setFilterDateFrom] = useState<string>('');
  const [filterDateTo, setFilterDateTo] = useState<string>('');
  const [showFilters, setShowFilters] = useState(false);

  const [users, setUsers] = useState<Array<{ $id: string; name: string; email: string }>>([]);

  // Redirect if not admin
  useEffect(() => {
    if (!loading && user && !canReadAuditLogs) {
      router.push('/dashboard');
    }
  }, [user, canReadAuditLogs, loading, router]);

  const fetchNames = async () => {
    try {
      const map = new Map<string, string>();

      // Fetch branches
      const branches = await listBranches();
      branches.forEach(b => map.set(b.$id, b.name));

      // Fetch users (limit 1000 for now)
      const users = await databases.listDocuments(
        DATABASE_ID,
        COLLECTIONS.USERS,
        [Query.limit(1000)]
      );
      const userList: Array<{ $id: string; name: string; email: string }> = [];
      users.documents.forEach((doc) => {
        const userDoc = doc as { $id: string; name?: unknown; email?: unknown };
        const name = getString(userDoc.name, getString(userDoc.email, userDoc.$id));
        map.set(userDoc.$id, name);
        userList.push({
          $id: userDoc.$id,
          name,
          email: getString(userDoc.email, ''),
        });
      });
      setUsers(userList);

      try {
        const leads = await databases.listDocuments(
          DATABASE_ID,
          COLLECTIONS.LEADS,
          [Query.limit(1000)]
        );
        leads.documents.forEach((doc) => {
          const leadDoc = doc as { $id: string; data?: unknown };
          const leadName = parseLeadNameFromData(leadDoc.data);
          if (leadName) {
            map.set(leadDoc.$id, leadName);
          }
        });
      } catch (leadError) {
        console.warn('Could not load lead names for audit logs:', leadError);
      }

      setIdToNameMap(map);
    } catch (err) {
      console.error('Error fetching names for audit logs:', err);
    }
  };

  const fetchLogs = async () => {
    try {
      setRefreshing(true);
      // Build filters object, only including non-empty values
      const auditFilters: any = { limit: 5000 };
      if (filterAction) auditFilters.action = filterAction;
      if (filterTargetType) auditFilters.targetType = filterTargetType;
      if (filterActorId) auditFilters.actorId = filterActorId;
      if (filterDateFrom) auditFilters.dateFrom = new Date(filterDateFrom).toISOString();
      if (filterDateTo) {
        // Add 1 day to include the entire end date
        const toDate = new Date(filterDateTo);
        toDate.setDate(toDate.getDate() + 1);
        auditFilters.dateTo = toDate.toISOString();
      }
      const { logs: fetchedLogs } = await getAuditLogs(auditFilters);
      setLogs(fetchedLogs);
    } catch (error) {
      console.error('Failed to fetch audit logs:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const clearFilters = () => {
    setFilterAction('');
    setFilterTargetType('');
    setFilterActorId('');
    setFilterDateFrom('');
    setFilterDateTo('');
  };

  useEffect(() => {
    if (canReadAuditLogs) {
      fetchLogs();
      fetchNames();
    } else if (user) {
      setLoading(false); // Stop loading to trigger redirect
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canReadAuditLogs, user, filterAction, filterTargetType, filterActorId, filterDateFrom, filterDateTo]);

  const totalPages = Math.ceil(logs.length / ITEMS_PER_PAGE);
  const paginatedLogs = logs.slice(
    (currentPage - 1) * ITEMS_PER_PAGE,
    currentPage * ITEMS_PER_PAGE
  );

  const resolveName = (id: string) => {
    return idToNameMap.get(id) || id;
  };

  const renderDetailModel = (model: AuditLogDetailModel) => {
    const toneStyles = {
      default: { background: 'var(--surface-2,#252422)', color: 'var(--muted-foreground)', border: '1px solid var(--border)' },
      success: { background: 'rgba(74,222,128,0.15)', color: '#4ade80', border: '1px solid rgba(74,222,128,0.30)' },
      warning: { background: 'rgba(251,191,36,0.15)', color: '#fbbf24', border: '1px solid rgba(251,191,36,0.30)' },
      danger: { background: 'rgba(248,113,113,0.15)', color: '#f87171', border: '1px solid rgba(248,113,113,0.30)' },
      info: { background: 'rgba(96,170,238,0.15)', color: '#60aaee', border: '1px solid rgba(96,170,238,0.30)' },
      purple: { background: 'rgba(167,139,250,0.15)', color: '#a78bfa', border: '1px solid rgba(167,139,250,0.30)' },
    } satisfies Record<AuditLogDetailModel['tone'], CSSProperties>;

    return (
      <div className="space-y-4">
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            padding: '0.125rem 0.625rem',
            borderRadius: '999px',
            fontSize: '0.6875rem',
            fontWeight: 500,
            ...toneStyles[model.tone],
          }}
        >
          {model.badge}
        </span>

        {model.rows.length > 0 && (
          <div className="space-y-1">
            {model.rows.map((row) => (
              <div key={`${row.label}-${row.value}`} className="grid grid-cols-3 gap-2 text-sm border-b py-2 last:border-0">
                <span className="font-medium text-muted-foreground">{row.label}</span>
                <span className="col-span-2 break-all">{row.value}</span>
              </div>
            ))}
          </div>
        )}

        {model.changes.length > 0 && (
          <div>
            <h4 className="mb-2 text-sm font-semibold">Changes</h4>
            <div className="space-y-2">
              {model.changes.map((change) => (
                <div key={`${change.label}-${change.from}-${change.to}`} className="rounded-md border border-border p-3 text-sm">
                  <p className="font-medium">{change.label}</p>
                  <p className="mt-1 text-muted-foreground">
                    <span className="line-through">{change.from}</span>
                    <span className="mx-2">-&gt;</span>
                    <span className="font-semibold text-foreground">{change.to}</span>
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderDetails = (log: AuditLog) => {
    if (!log.metadata) return <p className="text-muted-foreground">No details available.</p>;

    let metadata: MetadataRecord;
    try {
      metadata = JSON.parse(log.metadata) as MetadataRecord;
    } catch {
      return <pre className="text-xs">{log.metadata}</pre>;
    }

    if (
      log.action === 'SETTINGS_UPDATE' ||
      (log.action === 'USER_UPDATE' && metadata.profileSelfUpdate) ||
      log.targetType.toUpperCase() === 'LEAD'
    ) {
      return renderDetailModel(buildAuditLogDetailModel(log, idToNameMap));
    }

    if (log.action === 'FORM_CONFIG_UPDATE' && metadata.changes) {
      const { added, removed, modified } = metadata.changes as {
        added?: FormAuditField[];
        removed?: FormAuditField[];
        modified?: FormAuditModifiedField[];
      };
      return (
        <div className="space-y-4">
          {metadata.isCreation === true && (
            <div style={{ padding: '0.5rem 0.75rem', background: 'rgba(56,152,236,0.12)', border: '1px solid rgba(56,152,236,0.25)', borderRadius: '0.5rem', color: '#60aaee', fontSize: '0.8125rem', marginBottom: '0.5rem' }}>
              Initial Form Configuration Created
            </div>
          )}

          {added && added.length > 0 && (
            <div>
              <h4 style={{ fontWeight: 600, color: '#4ade80', marginBottom: '0.5rem', fontSize: '0.875rem' }}>Added Fields</h4>
              <ul className="list-disc pl-5 space-y-1 text-sm">
                {added.map((f) => (
                  <li key={f.key}>
                    <span className="font-medium">{f.label}</span> ({f.type})
                  </li>
                ))}
              </ul>
            </div>
          )}

          {removed && removed.length > 0 && (
            <div>
              <h4 style={{ fontWeight: 600, color: '#f87171', marginBottom: '0.5rem', fontSize: '0.875rem' }}>Removed Fields</h4>
              <ul className="list-disc pl-5 space-y-1 text-sm">
                {removed.map((f) => (
                  <li key={f.key}>
                    <span className="font-medium">{f.label}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {modified && modified.length > 0 && (
            <div>
              <h4 style={{ fontWeight: 600, color: '#fbbf24', marginBottom: '0.5rem', fontSize: '0.875rem' }}>Modified Fields</h4>
              <div className="space-y-3">
                {modified.map((m) => (
                  <div key={m.key} style={{ fontSize: '0.875rem', borderLeft: '2px solid rgba(251,191,36,0.4)', paddingLeft: '0.75rem' }}>
                    <p className="font-medium">{m.label}</p>
                    <ul className="mt-1 space-y-1 text-muted-foreground">
                      {Object.entries(m.changes).map(([prop, change]) => (
                        <li key={prop}>
                          <span className="font-mono text-xs">{prop}</span>:
                          <span className="line-through mx-1">{String(change.from)}</span>
                          →
                          <span className="font-semibold mx-1 text-foreground">{String(change.to)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          )}

          {!added?.length && !removed?.length && !modified?.length && !metadata.isCreation && (
             <p className="text-muted-foreground text-sm">No field changes detected (version update only).</p>
          )}
        </div>
      );
    }

    // ── Mock Interview ──────────────────────────────────────────────────────────
    if (log.action === 'MOCK_EMAIL_SENT') {
      const rows: [string, string][] = [
        ['Candidate Name', getString(metadata.candidateName, '-')],
        ['Lead', (metadata.leadId ? resolveName(getString(metadata.leadId, '')) : '-')],
        ['Attempt #', getString(metadata.attemptCount, '-')],
      ];
      return (
        <div className="space-y-1">
          <div className="flex items-center gap-2 mb-3">
            <span style={{ display: 'inline-flex', alignItems: 'center', padding: '0.125rem 0.625rem', borderRadius: '999px', fontSize: '0.6875rem', fontWeight: 500, background: 'rgba(167,139,250,0.15)', color: '#a78bfa', border: '1px solid rgba(167,139,250,0.30)' }}>
              Mock Interview Email
            </span>
          </div>
          {rows.map(([label, value]) => (
            <div key={label} className="grid grid-cols-3 gap-2 text-sm border-b py-2 last:border-0">
              <span className="font-medium text-muted-foreground">{label}</span>
              <span className="col-span-2 break-all">{value}</span>
            </div>
          ))}
        </div>
      );
    }

    // ── Interview Support ───────────────────────────────────────────────────────
    if (log.action === 'INTERVIEW_EMAIL_SENT') {
      const rows: [string, string][] = [
        ['Subject', getString(metadata.subject, '-')],
        ['Candidate Name', getString(metadata.candidateName, '-')],
        ['Technology', getString(metadata.technology, '-')],
        ['End Client', getString(metadata.endClient, '-')],
        ['Job Title', getString(metadata.jobTitle, '-')],
        ['Interview Round', getString(metadata.interviewRound, '-')],
        ['Date & Time (EST)', getString(metadata.interviewDate, '-')],
        ['Duration', getString(metadata.duration, '-')],
        ['Email ID', getString(metadata.emailId, '-')],
        ['Contact Number', getString(metadata.contactNumber, '-')],
        ['Attempt #', getString(metadata.attemptCount, '-')],
      ];
      return (
        <div className="space-y-1">
          <div className="flex items-center gap-2 mb-3">
            <span style={{ display: 'inline-flex', alignItems: 'center', padding: '0.125rem 0.625rem', borderRadius: '999px', fontSize: '0.6875rem', fontWeight: 500, background: 'rgba(99,179,237,0.15)', color: '#63b3ed', border: '1px solid rgba(99,179,237,0.30)' }}>
              Interview Support Email
            </span>
          </div>
          {rows.map(([label, value]) => (
            <div key={label} className="grid grid-cols-3 gap-2 text-sm border-b py-2 last:border-0">
              <span className="font-medium text-muted-foreground">{label}</span>
              <span className="col-span-2 break-all">{value}</span>
            </div>
          ))}
        </div>
      );
    }

    // ── Assessment Support ──────────────────────────────────────────────────────
    if (log.action === 'ASSESSMENT_EMAIL_SENT') {
      const rows: [string, string][] = [
        ['Subject', getString(metadata.subject, '-')],
        ['Candidate Name', getString(metadata.candidateName, '-')],
        ['Technology', getString(metadata.technology, '-')],
        ['End Client', getString(metadata.endClient, '-')],
        ['Job Title', getString(metadata.jobTitle, '-')],
        ['Interview Round', getString(metadata.interviewRound, '-')],
        ['Assessment Received (EST)', getString(metadata.assessmentReceived, '-')],
        ['Assessment Duration', getString(metadata.assessmentDuration, '-')],
        ['Email ID', getString(metadata.emailId, '-')],
        ['Contact Number', getString(metadata.contactNumber, '-')],
        ['Attempt #', getString(metadata.attemptCount, '-')],
      ];
      return (
        <div className="space-y-1">
          <div className="flex items-center gap-2 mb-3">
            <span style={{ display: 'inline-flex', alignItems: 'center', padding: '0.125rem 0.625rem', borderRadius: '999px', fontSize: '0.6875rem', fontWeight: 500, background: 'rgba(52,211,153,0.15)', color: '#34d399', border: '1px solid rgba(52,211,153,0.30)' }}>
              Assessment Support Email
            </span>
          </div>
          {rows.map(([label, value]) => (
            <div key={label} className="grid grid-cols-3 gap-2 text-sm border-b py-2 last:border-0">
              <span className="font-medium text-muted-foreground">{label}</span>
              <span className="col-span-2 break-all">{value}</span>
            </div>
          ))}
        </div>
      );
    }

    // Generic JSON renderer with ID resolution
    return (
      <div className="space-y-2">
        {Object.entries(metadata).map(([key, value]) => {
          if (key === 'changes' || key === 'isCreation') return null; // Skip internal fields if not handled above

          let displayValue = String(value);

          // Try to resolve IDs in arrays (e.g. branchIds)
          if (Array.isArray(value)) {
             displayValue = value.map(v => resolveName(String(v))).join(', ');
          }
          // Try to resolve ID in string (if it looks like an ID and exists in map)
          else if (typeof value === 'string' && idToNameMap.has(value)) {
             displayValue = resolveName(value);
          }

          return (
            <div key={key} className="grid grid-cols-3 gap-2 text-sm border-b py-2 last:border-0">
              <span className="font-medium text-muted-foreground">{key}</span>
              <span className="col-span-2 break-all">{displayValue}</span>
            </div>
          );
        })}
      </div>
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full min-h-[400px]">
        <Spinner size="lg" />
      </div>
    );
  }

  if (!canReadAuditLogs) {
    return null; // Will redirect
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Audit Logs</h1>
          <p className="text-muted-foreground mt-1">
            Track system activities and user actions.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => setShowFilters(!showFilters)}
            className="gap-2"
          >
            <Filter className="h-4 w-4" />
            {showFilters ? 'Hide Filters' : 'Show Filters'}
          </Button>
          <Button
            variant="outline"
            onClick={fetchLogs}
            disabled={refreshing}
            className="gap-2"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      {showFilters && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Filter Audit Logs</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="filter-action">Action</Label>
                <select
                  id="filter-action"
                  value={filterAction}
                  onChange={(e) => setFilterAction(e.target.value)}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  <option value="">All Actions</option>
                  {AUDIT_ACTIONS.map((a) => (
                    <option key={a} value={a}>{a}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="filter-target">Target Type</Label>
                <select
                  id="filter-target"
                  value={filterTargetType}
                  onChange={(e) => setFilterTargetType(e.target.value)}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  <option value="">All Target Types</option>
                  {AUDIT_TARGET_TYPES.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="filter-actor">Actor</Label>
                <select
                  id="filter-actor"
                  value={filterActorId}
                  onChange={(e) => setFilterActorId(e.target.value)}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  <option value="">All Actors</option>
                  {users.map((u) => (
                    <option key={u.$id} value={u.$id}>{u.name} ({u.email})</option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="filter-date-from">From Date</Label>
                <DatePicker
                  value={filterDateFrom}
                  onChange={setFilterDateFrom}
                  placeholder="Any date"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="filter-date-to">To Date</Label>
                <DatePicker
                  value={filterDateTo}
                  onChange={setFilterDateTo}
                  placeholder="Any date"
                />
              </div>

              <div className="space-y-2 flex items-end">
                <Button
                  variant="outline"
                  onClick={clearFilters}
                  className="w-full"
                >
                  Clear Filters
                </Button>
              </div>
            </div>

            <div className="mt-3 text-sm text-muted-foreground">
              Showing {logs.length} log{logs.length === 1 ? '' : 's'}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Activity Log</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Time</TableHead>
                  <TableHead>Actor</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Target Type</TableHead>
                  <TableHead>Details</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="h-24 text-center">
                      No audit logs found.
                    </TableCell>
                  </TableRow>
                ) : (
                  paginatedLogs.map((log) => (
                    <TableRow key={log.$id}>
                      <TableCell className="whitespace-nowrap font-medium">
                        {new Date(log.performedAt).toLocaleString()}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <UserIcon className="h-3 w-3 text-muted-foreground" />
                          <span>{log.actorName}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <span style={{
                          display: 'inline-flex', alignItems: 'center',
                          padding: '0.125rem 0.625rem', borderRadius: '999px',
                          fontSize: '0.6875rem', fontWeight: 500,
                          ...(log.action === 'MOCK_EMAIL_SENT'
                            ? { background: 'rgba(167,139,250,0.15)', color: '#a78bfa', border: '1px solid rgba(167,139,250,0.30)' }
                            : log.action === 'INTERVIEW_EMAIL_SENT'
                            ? { background: 'rgba(99,179,237,0.15)', color: '#63b3ed', border: '1px solid rgba(99,179,237,0.30)' }
                            : log.action === 'ASSESSMENT_EMAIL_SENT'
                            ? { background: 'rgba(52,211,153,0.15)', color: '#34d399', border: '1px solid rgba(52,211,153,0.30)' }
                            : log.action.includes('DELETE')
                            ? { background: 'rgba(248,113,113,0.15)', color: '#f87171', border: '1px solid rgba(248,113,113,0.30)' }
                            : log.action.includes('UPDATE')
                            ? { background: 'rgba(96,170,238,0.15)', color: '#60aaee', border: '1px solid rgba(96,170,238,0.30)' }
                            : log.action.includes('CREATE')
                            ? { background: 'rgba(74,222,128,0.15)', color: '#4ade80', border: '1px solid rgba(74,222,128,0.30)' }
                            : { background: 'var(--surface-2,#252422)', color: 'var(--muted-foreground)', border: '1px solid var(--border)' })
                        }}>
                          {log.action}
                        </span>
                      </TableCell>
                      <TableCell>{log.targetType}</TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setSelectedLog(log)}
                          className="flex items-center gap-1"
                        >
                          <Eye className="h-3 w-3" />
                          View Details
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          {/* Pagination Controls */}
          {totalPages > 1 && (
            <div className="flex items-center justify-end space-x-2 py-4">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage((prev) => Math.max(prev - 1, 1))}
                disabled={currentPage === 1}
              >
                Previous
              </Button>
              <div className="text-sm font-medium">
                Page {currentPage} of {totalPages}
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage((prev) => Math.min(prev + 1, totalPages))}
                disabled={currentPage === totalPages}
              >
                Next
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!selectedLog} onOpenChange={(open) => !open && setSelectedLog(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Audit Log Details</DialogTitle>
            <DialogDescription>
              {selectedLog && (
                <span className="flex flex-col gap-1">
                  <span>
                    Action: <span className="font-medium text-foreground">{selectedLog.action}</span>
                  </span>
                  <span>
                    Performed by: <span className="font-medium text-foreground">{selectedLog.actorName}</span> on {new Date(selectedLog.performedAt).toLocaleString()}
                  </span>
                </span>
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="mt-4">
            {selectedLog && renderDetails(selectedLog)}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function AuditLogsPage() {
  return (
    <ProtectedRoute componentKey="audit-logs">
      <AuditLogsContent />
    </ProtectedRoute>
  );
}
