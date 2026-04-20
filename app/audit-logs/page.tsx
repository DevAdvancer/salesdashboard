'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/contexts/auth-context';
import { useAccess } from '@/lib/contexts/access-control-context';
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
import { RefreshCw, FileText, User as UserIcon, Eye } from 'lucide-react';
import { ProtectedRoute } from '@/components/protected-route';
import { databases, DATABASE_ID, COLLECTIONS } from '@/lib/appwrite';
import { listBranches } from '@/lib/services/branch-service';

function AuditLogsContent() {
  const { user, isAdmin } = useAuth();
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedLog, setSelectedLog] = useState<AuditLog | null>(null);
  const [idToNameMap, setIdToNameMap] = useState<Map<string, string>>(new Map());
  const [currentPage, setCurrentPage] = useState(1);
  const ITEMS_PER_PAGE = 10;
  const router = useRouter();

  // Redirect if not admin
  useEffect(() => {
    if (!loading && user && !isAdmin) {
      router.push('/dashboard');
    }
  }, [user, isAdmin, loading, router]);

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
        [
          // Query.limit(1000) // Default is usually smaller, maybe need pagination if many users
        ]
      );
      users.documents.forEach((u: any) => map.set(u.$id, u.name));

      setIdToNameMap(map);
    } catch (err) {
      console.error('Error fetching names for audit logs:', err);
    }
  };

  const fetchLogs = async () => {
    try {
      setRefreshing(true);
      // Increased limit to 5000 to show more logs.
      // Ideally, this should be server-side paginated, but for now we fetch more to support client-side pagination.
      const { logs: fetchedLogs } = await getAuditLogs({ limit: 5000 });
      setLogs(fetchedLogs);
    } catch (error) {
      console.error('Failed to fetch audit logs:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    if (isAdmin) {
      fetchLogs();
      fetchNames();
    } else if (user) {
      setLoading(false); // Stop loading to trigger redirect
    }
  }, [isAdmin, user]);

  const totalPages = Math.ceil(logs.length / ITEMS_PER_PAGE);
  const paginatedLogs = logs.slice(
    (currentPage - 1) * ITEMS_PER_PAGE,
    currentPage * ITEMS_PER_PAGE
  );

  const resolveName = (id: string) => {
    return idToNameMap.get(id) || id;
  };

  const renderDetails = (log: AuditLog) => {
    if (!log.metadata) return <p className="text-muted-foreground">No details available.</p>;

    let metadata: any;
    try {
      metadata = JSON.parse(log.metadata);
    } catch {
      return <pre className="text-xs">{log.metadata}</pre>;
    }

    if (log.action === 'FORM_CONFIG_UPDATE' && metadata.changes) {
      const { added, removed, modified } = metadata.changes;
      return (
        <div className="space-y-4">
          {metadata.isCreation && (
            <div className="p-2 bg-blue-50 text-blue-700 rounded text-sm mb-2">
              Initial Form Configuration Created
            </div>
          )}

          {added && added.length > 0 && (
            <div>
              <h4 className="font-semibold text-green-600 mb-2">Added Fields</h4>
              <ul className="list-disc pl-5 space-y-1 text-sm">
                {added.map((f: any) => (
                  <li key={f.key}>
                    <span className="font-medium">{f.label}</span> ({f.type})
                  </li>
                ))}
              </ul>
            </div>
          )}

          {removed && removed.length > 0 && (
            <div>
              <h4 className="font-semibold text-red-600 mb-2">Removed Fields</h4>
              <ul className="list-disc pl-5 space-y-1 text-sm">
                {removed.map((f: any) => (
                  <li key={f.key}>
                    <span className="font-medium">{f.label}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {modified && modified.length > 0 && (
            <div>
              <h4 className="font-semibold text-amber-600 mb-2">Modified Fields</h4>
              <div className="space-y-3">
                {modified.map((m: any) => (
                  <div key={m.key} className="text-sm border-l-2 border-amber-200 pl-3">
                    <p className="font-medium">{m.label}</p>
                    <ul className="mt-1 space-y-1 text-muted-foreground">
                      {Object.entries(m.changes).map(([prop, change]: [string, any]) => (
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
        ['Candidate Name', metadata.candidateName || '—'],
        ['Lead ID', metadata.leadId || log.targetId || '—'],
        ['Attempt #', String(metadata.attemptCount ?? '—')],
      ];
      return (
        <div className="space-y-1">
          <div className="flex items-center gap-2 mb-3">
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-800">
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
        ['Subject', metadata.subject || '—'],
        ['Candidate Name', metadata.candidateName || '—'],
        ['Technology', metadata.technology || '—'],
        ['End Client', metadata.endClient || '—'],
        ['Job Title', metadata.jobTitle || '—'],
        ['Interview Round', metadata.interviewRound || '—'],
        ['Date & Time (EST)', metadata.interviewDate || '—'],
        ['Duration', metadata.duration || '—'],
        ['Email ID', metadata.emailId || '—'],
        ['Contact Number', metadata.contactNumber || '—'],
        ['Attempt #', String(metadata.attemptCount ?? '—')],
      ];
      return (
        <div className="space-y-1">
          <div className="flex items-center gap-2 mb-3">
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-indigo-100 text-indigo-800">
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
        ['Subject', metadata.subject || '—'],
        ['Candidate Name', metadata.candidateName || '—'],
        ['Technology', metadata.technology || '—'],
        ['End Client', metadata.endClient || '—'],
        ['Job Title', metadata.jobTitle || '—'],
        ['Assessment Received (EST)', metadata.assessmentReceived || '—'],
        ['Assessment Duration', metadata.assessmentDuration || '—'],
        ['Email ID', metadata.emailId || '—'],
        ['Contact Number', metadata.contactNumber || '—'],
        ['Attempt #', String(metadata.attemptCount ?? '—')],
      ];
      return (
        <div className="space-y-1">
          <div className="flex items-center gap-2 mb-3">
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-teal-100 text-teal-800">
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

  if (!isAdmin) {
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
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                          log.action === 'MOCK_EMAIL_SENT' ? 'bg-purple-100 text-purple-800' :
                          log.action === 'INTERVIEW_EMAIL_SENT' ? 'bg-indigo-100 text-indigo-800' :
                          log.action === 'ASSESSMENT_EMAIL_SENT' ? 'bg-teal-100 text-teal-800' :
                          log.action.includes('DELETE') ? 'bg-red-100 text-red-800' :
                          log.action.includes('UPDATE') ? 'bg-blue-100 text-blue-800' :
                          log.action.includes('CREATE') ? 'bg-green-100 text-green-800' :
                          'bg-gray-100 text-gray-800'
                        }`}>
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
