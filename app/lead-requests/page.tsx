'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Check, ExternalLink, RefreshCw, X } from 'lucide-react';
import {
  getLeadRequestAdminOptionsAction,
  listLeadRequestsAction,
  moveLeadRequestToLeadAction,
  rejectLeadRequestAction,
  type LeadRequestAdminOptions,
} from '@/app/actions/lead-requests';
import { ProtectedRoute } from '@/components/protected-route';
import { Button } from '@/components/ui/button';
import type { LeadRequest } from '@/lib/types';
import { useAuth } from '@/lib/contexts/auth-context';

type AssignmentState = Record<string, { assignedToId: string; branchId: string }>;
type ErrorState = Record<string, string>;

export default function LeadRequestsPage() {
  return (
    <ProtectedRoute componentKey="lead-requests">
      <LeadRequestsContent />
    </ProtectedRoute>
  );
}

function LeadRequestsContent() {
  const { user } = useAuth();
  const isMonitor = user?.role === 'monitor';
  const [requests, setRequests] = useState<LeadRequest[]>([]);
  const [options, setOptions] = useState<LeadRequestAdminOptions>({ users: [], branches: [] });
  const [assignments, setAssignments] = useState<AssignmentState>({});
  const [errors, setErrors] = useState<ErrorState>({});
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');

  const pendingCount = useMemo(
    () => requests.filter((request) => request.status === 'pending').length,
    [requests],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setErrors({});
    try {
      const [requestList, adminOptions] = await Promise.all([
        listLeadRequestsAction(),
        getLeadRequestAdminOptionsAction(),
      ]);
      setRequests(requestList);
      setOptions(adminOptions);
      setAssignments((current) => {
        const next = { ...current };
        requestList.forEach((request) => {
          if (!next[request.$id]) next[request.$id] = { assignedToId: '', branchId: '' };
        });
        return next;
      });
    } catch (error) {
      setErrors({ page: error instanceof Error ? error.message : 'Failed to load lead requests.' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const updateAssignment = (requestId: string, field: 'assignedToId' | 'branchId', value: string) => {
    setAssignments((current) => ({
      ...current,
      [requestId]: {
        assignedToId: current[requestId]?.assignedToId ?? '',
        branchId: current[requestId]?.branchId ?? '',
        [field]: value,
      },
    }));
  };

  const moveToLead = async (requestId: string) => {
    setBusyId(requestId);
    setErrors((current) => ({ ...current, [requestId]: '' }));
    try {
      const assignment = assignments[requestId] ?? { assignedToId: '', branchId: '' };
      await moveLeadRequestToLeadAction({
        requestId,
        assignedToId: assignment.assignedToId || undefined,
        branchId: assignment.branchId || undefined,
      });
      await load();
    } catch (error) {
      setErrors((current) => ({
        ...current,
        [requestId]: error instanceof Error ? error.message : 'Failed to move request.',
      }));
    } finally {
      setBusyId('');
    }
  };

  const reject = async (requestId: string) => {
    setBusyId(requestId);
    setErrors((current) => ({ ...current, [requestId]: '' }));
    try {
      await rejectLeadRequestAction(requestId);
      await load();
    } catch (error) {
      setErrors((current) => ({
        ...current,
        [requestId]: error instanceof Error ? error.message : 'Failed to reject request.',
      }));
    } finally {
      setBusyId('');
    }
  };

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-normal">Lead Requests</h1>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            Review public referral submissions before moving them into Leads.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="rounded-full border border-[var(--border)] px-3 py-1 text-sm text-[var(--muted-foreground)]">
            {pendingCount} pending
          </span>
          <Button type="button" variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw size={16} />
            Refresh
          </Button>
        </div>
      </header>

      {errors.page ? (
        <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
          {errors.page}
        </div>
      ) : null}

      <div className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--card)]">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1080px] border-collapse text-sm">
            <thead className="border-b border-[var(--border)] bg-[var(--muted)]/40 text-left">
              <tr>
                <Th>Lead</Th>
                <Th>Contact</Th>
                <Th>Referral</Th>
                <Th>Assign</Th>
                <Th>Status</Th>
                <Th>Action</Th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-[var(--muted-foreground)]">
                    Loading lead requests...
                  </td>
                </tr>
              ) : requests.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-[var(--muted-foreground)]">
                    No referral requests yet.
                  </td>
                </tr>
              ) : (
                requests.map((request) => (
                  <tr key={request.$id} className="border-b border-[var(--border)] align-top last:border-0">
                    <Td>
                      <div className="space-y-1">
                        <p className="font-medium">{request.name}</p>
                        <p className="text-xs text-[var(--muted-foreground)]">
                          {formatDate(request.createdAt || request.$createdAt)}
                        </p>
                        {request.city ? <p className="text-xs text-[var(--muted-foreground)]">{request.city}</p> : null}
                      </div>
                    </Td>
                    <Td>
                      <div className="space-y-1">
                        {request.phone ? <p>{request.phone}</p> : null}
                        {request.email ? <p>{request.email}</p> : null}
                        {request.linkedinProfileUrl ? (
                          <a
                            href={request.linkedinProfileUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-[var(--primary)] hover:underline"
                          >
                            LinkedIn <ExternalLink size={13} />
                          </a>
                        ) : null}
                      </div>
                    </Td>
                    <Td>
                      <div className="space-y-1">
                        {request.interestedService ? <p className="font-medium text-xs">{request.interestedService}</p> : null}
                        {request.referrerName ? (
                          <p className="text-xs text-[var(--muted-foreground)] font-medium">By {request.referrerName}</p>
                        ) : null}
                        {request.referrerCompany ? (
                          <p className="text-xs text-[var(--muted-foreground)]">Company: {request.referrerCompany}</p>
                        ) : null}
                        {request.bonusAmount || request.paymentDate || request.paymentMode || request.salesPerson ? (
                          <div className="mt-2 rounded-md bg-[var(--muted)]/50 p-2 text-xs text-[var(--muted-foreground)] space-y-0.5 border border-[var(--border)] max-w-xs">
                            <p className="font-semibold text-[var(--foreground)] text-[9px] uppercase tracking-wider mb-1">Reference Bonus</p>
                            {request.bonusAmount ? <p>Amount: <span className="font-medium text-[var(--foreground)]">{request.bonusAmount}</span></p> : null}
                            {request.paymentDate ? <p>Date: <span className="font-medium text-[var(--foreground)]">{request.paymentDate}</span></p> : null}
                            {request.paymentMode ? <p>Mode: <span className="font-medium text-[var(--foreground)]">{request.paymentMode}</span></p> : null}
                            {request.salesPerson ? <p>Sales Person: <span className="font-medium text-[var(--foreground)]">{request.salesPerson}</span></p> : null}
                          </div>
                        ) : null}
                        {request.notes ? <p className="max-w-xs text-xs mt-1 text-[var(--muted-foreground)] italic">{request.notes}</p> : null}
                      </div>
                    </Td>
                    <Td>
                      {isMonitor ? (
                        <span className="text-xs text-[var(--muted-foreground)]">View only</span>
                      ) : (
                        <div className="grid gap-2">
                          <select
                            className="h-9 rounded-md border border-[var(--border)] bg-[var(--background)] px-2 text-sm"
                            value={assignments[request.$id]?.assignedToId ?? ''}
                            onChange={(event) => updateAssignment(request.$id, 'assignedToId', event.target.value)}
                            disabled={request.status !== 'pending' || busyId === request.$id}
                          >
                            <option value="">No assignee</option>
                            {options.users.map((user) => (
                              <option key={user.$id} value={user.$id}>
                                {user.name} - {user.role}
                              </option>
                            ))}
                          </select>
                          <select
                            className="h-9 rounded-md border border-[var(--border)] bg-[var(--background)] px-2 text-sm"
                            value={assignments[request.$id]?.branchId ?? ''}
                            onChange={(event) => updateAssignment(request.$id, 'branchId', event.target.value)}
                            disabled={request.status !== 'pending' || busyId === request.$id}
                          >
                            <option value="">No branch</option>
                            {options.branches.map((branch) => (
                              <option key={branch.$id} value={branch.$id}>
                                {branch.name}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}
                    </Td>
                    <Td>
                      <div className="space-y-2">
                        <StatusBadge status={request.status} />
                        {request.duplicateMessage || errors[request.$id] ? (
                          <p className="max-w-xs text-xs leading-5 text-red-600">
                            {errors[request.$id] || request.duplicateMessage}
                          </p>
                        ) : null}
                        {request.movedLeadId ? (
                          <p className="text-xs text-[var(--muted-foreground)]">Lead: {request.movedLeadId}</p>
                        ) : null}
                      </div>
                    </Td>
                    <Td>
                      {!isMonitor && request.status === 'pending' ? (
                        <div className="flex flex-col gap-2">
                          <Button
                            type="button"
                            size="sm"
                            onClick={() => void moveToLead(request.$id)}
                            loading={busyId === request.$id}
                          >
                            <Check size={16} />
                            Move
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => void reject(request.$id)}
                            disabled={busyId === request.$id}
                          >
                            <X size={16} />
                            Reject
                          </Button>
                        </div>
                      ) : (
                        <span className="text-xs text-[var(--muted-foreground)]">{isMonitor ? 'View only' : 'No action'}</span>
                      )}
                    </Td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Th({ children }: { children: ReactNode }) {
  return <th className="px-4 py-3 font-medium text-[var(--muted-foreground)]">{children}</th>;
}

function Td({ children }: { children: ReactNode }) {
  return <td className="px-4 py-4">{children}</td>;
}

function StatusBadge({ status }: { status: string }) {
  const className =
    status === 'moved'
      ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
      : status === 'rejected'
        ? 'border-slate-300 bg-slate-50 text-slate-700'
        : 'border-amber-300 bg-amber-50 text-amber-700';

  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${className}`}>
      {status}
    </span>
  );
}

function formatDate(value?: string | null) {
  if (!value) return '';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
}
