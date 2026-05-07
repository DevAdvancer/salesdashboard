'use client';

import { useCallback, useEffect, useState } from 'react';
import { MessageSquareText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/use-toast';
import { createLeadNote, listLeadNotes } from '@/lib/services/sop-service';
import type { LeadNote, LeadNoteVisibility, User } from '@/lib/types';

interface LeadNotesCardProps {
  leadId: string;
  user: User;
}

export function LeadNotesCard({ leadId, user }: LeadNotesCardProps) {
  const { toast } = useToast();
  const [notes, setNotes] = useState<LeadNote[]>([]);
  const [body, setBody] = useState('');
  const visibility: LeadNoteVisibility = 'team'; // Hardcoded visibility
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadNotes = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const fetchedNotes = await listLeadNotes(user.$id, leadId);
      setNotes(fetchedNotes);
    } catch (error) {
      console.error('Failed to load notes:', error);
      setNotes([]);
      setError('Notes are not available for your current permissions.');
    } finally {
      setLoading(false);
    }
  }, [leadId, user.$id]);

  useEffect(() => {
    void loadNotes();
  }, [loadNotes]);

  const submitNote = async () => {
    if (!body.trim()) return;
    try {
      setSaving(true);
      await createLeadNote({
        actorId: user.$id,
        leadId,
        body: body.trim(),
        visibility,
      });
      setBody('');
      toast({ title: 'Note added', description: 'Lead note saved.' });
      await loadNotes();
    } catch (error) {
      console.error('Failed to create note:', error);
      toast({ title: 'Error', description: 'Failed to save note.', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MessageSquareText className="h-4 w-4" />
          Notes
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3">
          <div>
            <Label htmlFor="leadNote">Add Note</Label>
            <Textarea
              id="leadNote"
              value={body}
              onChange={(event) => setBody(event.target.value)}
              placeholder="Add a useful update, blocker, or next-step detail..."
            />
          </div>
          <div className="flex justify-end">
            <Button onClick={submitNote} disabled={saving || !body.trim()}>
              {saving ? 'Saving...' : 'Add Note'}
            </Button>
          </div>
        </div>

        <div className="space-y-3">
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading notes...</p>
          ) : error ? (
            <p className="rounded-md border border-destructive p-3 text-sm text-muted-foreground">
              {error}
            </p>
          ) : notes.length === 0 ? (
            <p className="rounded-md border border-dashed border-border p-3 text-sm text-muted-foreground">
              No notes yet.
            </p>
          ) : (
            notes.map((note) => (
              <div key={note.$id} className="rounded-md border border-border p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">{note.authorName}</p>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {new Date(note.createdAt).toLocaleString()}
                  </p>
                </div>
                <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{note.body}</p>
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
}
