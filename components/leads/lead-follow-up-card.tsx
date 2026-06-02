'use client';

import { useState } from 'react';
import { CalendarClock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DateTimePicker } from '@/components/ui/date-picker';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import { updateLeadFollowUp } from '@/lib/services/sop-service';
import type { Lead, User } from '@/lib/types';

interface LeadFollowUpCardProps {
  lead: Lead;
  user: User;
  disabled?: boolean;
  onUpdated: () => Promise<void> | void;
}

function toDateTimeLocal(value?: string | null) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const offsetMs = date.getTimezoneOffset() * 60 * 1000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

function fromDateTimeLocal(value: string) {
  return value ? new Date(value).toISOString() : null;
}

export function LeadFollowUpCard({ lead, user, disabled = false, onUpdated }: LeadFollowUpCardProps) {
  const { toast } = useToast();
  const [nextFollowUpAt, setNextFollowUpAt] = useState(toDateTimeLocal(lead.nextFollowUpAt));
  const [nextAction, setNextAction] = useState(lead.nextAction ?? '');
  const [followUpStatus, setFollowUpStatus] = useState(lead.followUpStatus ?? 'pending');
  const [lastContactedAt, setLastContactedAt] = useState(toDateTimeLocal(lead.lastContactedAt));
  const [saving, setSaving] = useState(false);

  const saveFollowUp = async () => {
    if (!nextFollowUpAt.trim()) {
      toast({
        title: 'Missing required field',
        description: 'Next Follow-Up is required.',
        variant: 'destructive',
      });
      return;
    }
    if (!nextAction.trim()) {
      toast({
        title: 'Missing required field',
        description: 'Next Action is required.',
        variant: 'destructive',
      });
      return;
    }

    try {
      setSaving(true);
      await updateLeadFollowUp({
        actorId: user.$id,
        leadId: lead.$id,
        nextFollowUpAt: fromDateTimeLocal(nextFollowUpAt),
        nextAction: nextAction || null,
        lastContactedAt: fromDateTimeLocal(lastContactedAt),
        followUpStatus: followUpStatus || 'pending',
      });
      toast({ title: 'Saved', description: 'Follow-up details updated.' });
      await onUpdated();
    } catch (error) {
      console.error('Failed to update follow-up:', error);
      toast({
        title: 'Error',
        description: 'Failed to update follow-up details.',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CalendarClock className="h-4 w-4" />
          Follow-Up Plan
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <Label htmlFor="nextFollowUpAt">
              Next Follow-Up
              <span className="text-red-500 ml-1">*</span>
            </Label>
            <DateTimePicker
              id="nextFollowUpAt"
              value={nextFollowUpAt}
              onChange={(value) => {
                setNextFollowUpAt(value);
                if ((lead.followUpStatus ?? 'pending') === 'completed' && value.trim()) {
                  setFollowUpStatus('pending');
                }
              }}
              disabled={disabled || saving}
            />
          </div>
          <div>
            <Label htmlFor="nextAction">
              Next Action
              <span className="text-red-500 ml-1">*</span>
            </Label>
            <select
              id="nextAction"
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
              value={nextAction}
              onChange={(event) => setNextAction(event.target.value)}
              disabled={disabled || saving}
            >
              <option value="">Select action</option>
              <option value="Call">Call</option>
              <option value="Email">Email</option>
              <option value="Meeting">Meeting</option>
              <option value="Documents Pending">Documents Pending</option>
              <option value="Follow up">Follow up</option>
            </select>
          </div>
          <div>
            <Label htmlFor="followUpStatus">Follow-Up Status</Label>
            <select
              id="followUpStatus"
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
              value={followUpStatus}
              onChange={(event) => setFollowUpStatus(event.target.value)}
              disabled={disabled || saving}
            >
              <option value="pending">Pending</option>
              <option value="completed">Completed</option>
              <option value="overdue">Overdue</option>
            </select>
          </div>
          <div>
            <Label htmlFor="lastContactedAt">Last Contacted</Label>
            <DateTimePicker
              id="lastContactedAt"
              value={lastContactedAt}
              onChange={setLastContactedAt}
              disabled={disabled || saving}
            />
          </div>
        </div>
        <div className="mt-4 flex justify-end">
          <Button onClick={saveFollowUp} disabled={disabled || saving}>
            {saving ? 'Saving...' : 'Save Follow-Up'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
