'use client';

import { useCallback, useEffect, useState } from 'react';
import { ProtectedRoute } from '@/components/protected-route';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/lib/contexts/auth-context';
import { createCoachingNote, listCoachingNotes } from '@/lib/services/sop-service';
import { getAssignableUsers } from '@/lib/services/user-service';
import type { CoachingNote, CoachingNoteVisibility, User } from '@/lib/types';

export default function CoachingNotesPage() {
  return (
    <ProtectedRoute componentKey="coaching-notes">
      <CoachingNotesContent />
    </ProtectedRoute>
  );
}

function CoachingNotesContent() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [users, setUsers] = useState<User[]>([]);
  const [notes, setNotes] = useState<CoachingNote[]>([]);
  const [targetUserId, setTargetUserId] = useState('');
  const visibility: CoachingNoteVisibility = 'leadership'; // Hardcoded visibility
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    if (!user) return;
    try {
      setLoading(true);
      setError(null);
      const [visibleUsers, fetchedNotes] = await Promise.all([
        getAssignableUsers(user.role, user.branchIds || [], user.$id, 'sales'),
        listCoachingNotes(user.$id),
      ]);
      setUsers(visibleUsers);
      setNotes(fetchedNotes);
    } catch (error) {
      console.error('Failed to load coaching notes:', error);
      setUsers([]);
      setNotes([]);
      setError('Coaching notes are not available for your current permissions.');
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const submitNote = async () => {
    if (!user || !targetUserId || !note.trim()) return;
    const target = users.find((item) => item.$id === targetUserId);
    try {
      setSaving(true);
      await createCoachingNote({
        actorId: user.$id,
        targetUserId,
        targetUserName: target?.name ?? null,
        note: note.trim(),
        visibility,
      });
      setNote('');
      toast({ title: 'Coaching note saved' });
      await loadData();
    } catch (error) {
      console.error('Failed to save coaching note:', error);
      toast({
        title: 'Error',
        description: 'You are not authorized to save this coaching note.',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="container mx-auto space-y-6">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold">Coaching Notes</h1>
        <p className="text-muted-foreground">Leadership-only coaching notes for users in your scope.</p>
      </div>
      {/* Add Coaching Note form — hidden for Monitor (view-only role) */}
      <Card>
          <CardHeader>
            <CardTitle>Add Coaching Note</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {error && (
              <p className="rounded-md border border-destructive p-3 text-sm text-muted-foreground">
                {error}
              </p>
            )}
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <Label htmlFor="targetUser">User</Label>
                <select
                  id="targetUser"
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
                  value={targetUserId}
                  onChange={(event) => setTargetUserId(event.target.value)}
                >
                  <option value="">Select user</option>
                  {users.map((item) => (
                    <option key={item.$id} value={item.$id}>{item.name} - {item.role.replace('_', ' ')}</option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <Label htmlFor="note">Note</Label>
              <Textarea id="note" value={note} onChange={(event) => setNote(event.target.value)} />
            </div>
            <Button onClick={submitNote} disabled={saving || !targetUserId || !note.trim()}>
              {saving ? 'Saving...' : 'Save Note'}
            </Button>
          </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Recent Coaching Notes</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading ? (
            <CoachingNotesSkeleton />
          ) : notes.length === 0 ? (
            <p className="text-sm text-muted-foreground">No coaching notes yet.</p>
          ) : notes.map((item) => (
            <div key={item.$id} className="rounded-md border border-border p-3">
              <p className="text-sm font-medium">{item.targetUserName || item.targetUserId}</p>
              <p className="text-xs text-muted-foreground">
                By {item.authorName} / {new Date(item.createdAt).toLocaleString()}
              </p>
              <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{item.note}</p>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function CoachingNotesSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 3 }).map((_, index) => (
        <div key={index} className="rounded-md border border-border p-3">
          <Skeleton className="h-4 w-48" />
          <Skeleton className="mt-2 h-3 w-64" />
          <Skeleton className="mt-4 h-3 w-full" />
          <Skeleton className="mt-2 h-3 w-2/3" />
        </div>
      ))}
    </div>
  );
}
