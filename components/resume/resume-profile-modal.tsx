'use client';

import { useState } from 'react';
import { X, UserPlus, PhoneCall } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { RESUME_PROFILE_STAGES, type CallRequest, type ResumeProfile, type ResumeProfileStage } from '@/lib/types';
import { createResumeProfileAction, type CreateResumeProfileInput } from '@/app/actions/resume-profiles';

interface ResumeProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated: (profile: ResumeProfile) => void;
  callRequests: (CallRequest & { $id: string })[];
  assignableUsers: { $id: string; name: string; email: string }[];
}

export function ResumeProfileModal({
  isOpen,
  onClose,
  onCreated,
  callRequests,
  assignableUsers,
}: ResumeProfileModalProps) {
  const [mode, setMode] = useState<'from_call' | 'manual'>('from_call');
  const [selectedCallId, setSelectedCallId] = useState<string>('');
  const [candidateName, setCandidateName] = useState<string>('');
  const [technology, setTechnology] = useState<string>('');
  const [usaArrival, setUsaArrival] = useState<string>('');
  const [stage, setStage] = useState<ResumeProfileStage>('1. Draft');
  const [assignedToId, setAssignedToId] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSelectCall = (id: string) => {
    setSelectedCallId(id);
    const found = callRequests.find((c) => c.$id === id);
    if (found) {
      setCandidateName(found.clientName);
      if (found.assignedToId && !assignedToId) {
        setAssignedToId(found.assignedToId);
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!candidateName.trim()) {
      setError('Candidate Name is required.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const selectedCall = callRequests.find((c) => c.$id === selectedCallId);
      const selectedUser = assignableUsers.find((u) => u.$id === assignedToId);

      const input: CreateResumeProfileInput = {
        candidateName: candidateName.trim(),
        technology: technology.trim() || null,
        usaArrival: usaArrival.trim() || null,
        stage,
        callRequestId: mode === 'from_call' && selectedCallId ? selectedCallId : null,
        leadId: mode === 'from_call' && selectedCall ? selectedCall.leadId : null,
        assignedToId: assignedToId || null,
        assignedToName: selectedUser?.name || null,
      };

      const created = await createResumeProfileAction(input);
      onCreated(created);
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Failed to create resume profile');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <Card className="w-full max-w-lg bg-background p-6 shadow-xl rounded-xl">
        <div className="flex items-center justify-between border-b pb-3 mb-4">
          <div className="flex items-center gap-2">
            <UserPlus className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold">Create Resume Profile</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground p-1 rounded-md"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex gap-2 mb-4">
          <Button
            type="button"
            variant={mode === 'from_call' ? 'default' : 'outline'}
            onClick={() => setMode('from_call')}
            className="flex-1 gap-2 text-xs"
          >
            <PhoneCall className="h-4 w-4" />
            From Call Request
          </Button>
          <Button
            type="button"
            variant={mode === 'manual' ? 'default' : 'outline'}
            onClick={() => {
              setMode('manual');
              setSelectedCallId('');
            }}
            className="flex-1 gap-2 text-xs"
          >
            <UserPlus className="h-4 w-4" />
            Manual Entry
          </Button>
        </div>

        {error && (
          <div className="mb-4 rounded-md bg-destructive/15 p-3 text-xs text-destructive">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === 'from_call' && (
            <div>
              <label className="block text-xs font-medium mb-1">
                Select Completed Call Request
              </label>
              <select
                value={selectedCallId}
                onChange={(e) => handleSelectCall(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="">-- Choose Call Request --</option>
                {callRequests.map((req) => (
                  <option key={req.$id} value={req.$id}>
                    {req.clientName} (Requested by: {req.requestedByName})
                  </option>
                ))}
              </select>
              {callRequests.length === 0 && (
                <p className="text-[11px] text-muted-foreground mt-1">
                  No pending Call Requests with status &quot;Call done&quot; found. You can switch to Manual Entry.
                </p>
              )}
            </div>
          )}

          <div>
            <label className="block text-xs font-medium mb-1">Candidate Name *</label>
            <input
              type="text"
              required
              value={candidateName}
              onChange={(e) => setCandidateName(e.target.value)}
              placeholder="e.g. John Doe"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1">Technology</label>
              <input
                type="text"
                value={technology}
                onChange={(e) => setTechnology(e.target.value)}
                placeholder="e.g. Java Full Stack"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">USA Arrival</label>
              <input
                type="text"
                value={usaArrival}
                onChange={(e) => setUsaArrival(e.target.value)}
                placeholder="e.g. Aug 2022"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1">Initial Stage</label>
              <select
                value={stage}
                onChange={(e) => setStage(e.target.value as ResumeProfileStage)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              >
                {RESUME_PROFILE_STAGES.map((st) => (
                  <option key={st} value={st}>
                    {st}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Assign To</label>
              <select
                value={assignedToId}
                onChange={(e) => setAssignedToId(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="">-- Unassigned --</option>
                {assignableUsers.map((u) => (
                  <option key={u.$id} value={u.$id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t mt-6">
            <Button type="button" variant="outline" onClick={onClose} disabled={loading}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? 'Creating...' : 'Create Profile'}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
