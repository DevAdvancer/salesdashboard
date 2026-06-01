'use client';

import { useCallback, useEffect, useState } from 'react';
import { ProtectedRoute } from '@/components/protected-route';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/lib/contexts/auth-context';
import {
  createReviewQueueItem,
  listReviewQueue,
  listReviewTargetOptions,
  updateReviewQueueStatus,
} from '@/lib/services/sop-service';
import type { ReviewQueueItem } from '@/lib/types';
import {
  findReviewTargetOption,
  type ReviewTargetOption,
  type ReviewTargetType,
} from '@/lib/utils/review-target-options';

export default function ReviewQueuePage() {
  return (
    <ProtectedRoute componentKey="review-queue">
      <ReviewQueueContent />
    </ProtectedRoute>
  );
}

function ReviewQueueContent() {
  const { user, isAdmin, isManager, isAssistantManager } = useAuth();
  const { toast } = useToast();
  const [items, setItems] = useState<ReviewQueueItem[]>([]);
  const [type, setType] = useState('lead_reopen');
  const [targetInput, setTargetInput] = useState('');
  const [targetType, setTargetType] = useState<ReviewTargetType>('LEAD');
  const [targetOptions, setTargetOptions] = useState<ReviewTargetOption[]>([]);
  const [targetOptionsLoading, setTargetOptionsLoading] = useState(false);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [loadingItems, setLoadingItems] = useState(true);
  const [error, setError] = useState<string | null>(null);
const canResolve = isAdmin || isManager || isAssistantManager;
  const selectedTarget = findReviewTargetOption(targetOptions, targetInput);

  const loadItems = useCallback(async () => {
    if (!user) return;
    try {
      setLoadingItems(true);
      setError(null);
      setItems(await listReviewQueue(user.$id));
    } catch (error) {
      console.error('Failed to load review queue:', error);
      setItems([]);
      setError('Review queue is not available for your current permissions.');
    } finally {
      setLoadingItems(false);
    }
  }, [user]);

  useEffect(() => {
    void loadItems();
  }, [loadItems]);

  useEffect(() => {
    if (!user) return;

    const timeoutId = window.setTimeout(async () => {
      try {
        setTargetOptionsLoading(true);
        const options = await listReviewTargetOptions({
          actorId: user.$id,
          targetType,
          searchQuery: targetInput,
        });
        setTargetOptions(options);
      } catch (error) {
        console.error('Failed to load review target options:', error);
        setTargetOptions([]);
      } finally {
        setTargetOptionsLoading(false);
      }
    }, 250);

    return () => window.clearTimeout(timeoutId);
  }, [user, targetType, targetInput]);

  const handleTargetTypeChange = (value: ReviewTargetType) => {
    setTargetType(value);
    setTargetInput('');
    setTargetOptions([]);
  };

  const submitRequest = async () => {
    if (!user || !targetInput.trim()) return;
    const resolvedTargetId = selectedTarget?.id ?? targetInput.trim();
    try {
      setSaving(true);
      await createReviewQueueItem({
        actorId: user.$id,
        type,
        targetId: resolvedTargetId,
        targetType,
        reason: reason.trim() || null,
        metadata: selectedTarget
          ? JSON.stringify({
              targetLabel: selectedTarget.label,
              targetDescription: selectedTarget.description,
            })
          : null,
      });
      setTargetInput('');
      setReason('');
      toast({ title: 'Review request created' });
      await loadItems();
    } catch (error) {
      console.error('Failed to create review request:', error);
      toast({
        title: 'Error',
        description: 'You are not authorized to create this review request.',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const updateStatus = async (itemId: string, status: string) => {
    if (!user) return;
    try {
      await updateReviewQueueStatus(user.$id, itemId, status);
      await loadItems();
    } catch (error) {
      console.error('Failed to update review request:', error);
      toast({
        title: 'Error',
        description: 'You are not authorized to update this review item.',
        variant: 'destructive',
      });
    }
  };

  return (
    <div className="container mx-auto space-y-6">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold">Review Queue</h1>
        <p className="text-muted-foreground">Escalations, approvals, duplicate checks, and leadership review items.</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Create Review Request</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <p className="rounded-md border border-destructive p-3 text-sm text-muted-foreground">
              {error}
            </p>
          )}
          <div className="grid gap-4 md:grid-cols-3">
            <div>
              <Label htmlFor="type">Type</Label>
              <select id="type" className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground" value={type} onChange={(e) => setType(e.target.value)}>
                <option value="lead_reopen">Lead Reopen</option>
                <option value="high_value_reassignment">High Value Reassignment</option>
                <option value="duplicate_warning">Duplicate Warning</option>
                <option value="closed_client_edit">Closed Client Edit</option>
                <option value="field_change_review">Field Change Review</option>
              </select>
            </div>
            <div>
              <Label htmlFor="targetType">Target Type</Label>
              <InputLikeSelect value={targetType} onChange={handleTargetTypeChange} />
            </div>
            <div>
              <Label htmlFor="target">Target</Label>
              <Input
                id="target"
                list="review-target-options"
                value={targetInput}
                onChange={(event) => setTargetInput(event.target.value)}
                placeholder={targetOptionsLoading ? 'Loading targets...' : 'Search or paste an ID'}
              />
              <datalist id="review-target-options">
                {targetOptions.map((option) => (
                  <option key={`${option.type}-${option.id}`} value={option.value}>
                    {option.description}
                  </option>
                ))}
              </datalist>
              <p className="mt-1 text-xs text-muted-foreground">
                {selectedTarget
                  ? 'Target selected.'
                  : targetInput.trim()
                    ? 'Typed value will be saved.'
                    : 'Choose from the dropdown.'}
              </p>
            </div>
          </div>
          <div>
            <Label htmlFor="reason">Reason</Label>
            <Textarea id="reason" value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <Button onClick={submitRequest} disabled={saving || !targetInput.trim()}>{saving ? 'Creating...' : 'Create Request'}</Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Queue Items</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {loadingItems ? (
            <ReviewQueueSkeleton />
          ) : items.length === 0 ? (
            <p className="text-sm text-muted-foreground">No review items yet.</p>
          ) : items.map((item) => {
            const targetLabel = getReviewTargetLabel(item);
            return (
            <div key={item.$id} className="rounded-md border border-border p-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-sm font-medium">{item.type.replaceAll('_', ' ')} / {item.status}</p>
                  <p className="text-xs text-muted-foreground">
                    {item.targetType}: {targetLabel} / Requested by {item.requestedByName}
                  </p>
                  {item.reason && <p className="mt-2 text-sm text-muted-foreground">{item.reason}</p>}
                </div>
                {canResolve && (
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => updateStatus(item.$id, 'approved')}>Approve</Button>
                    <Button size="sm" variant="outline" onClick={() => updateStatus(item.$id, 'rejected')}>Reject</Button>
                    <Button size="sm" variant="outline" onClick={() => updateStatus(item.$id, 'resolved')}>Resolve</Button>
                  </div>
                )}
              </div>
            </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}

function getReviewTargetLabel(item: ReviewQueueItem) {
  if (!item.metadata) {
    return 'Target';
  }

  try {
    const metadata = JSON.parse(item.metadata) as { targetLabel?: string };
    return metadata.targetLabel || 'Target';
  } catch {
    return 'Target';
  }
}

function ReviewQueueSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 3 }).map((_, index) => (
        <div key={index} className="rounded-md border border-border p-3">
          <Skeleton className="h-4 w-56" />
          <Skeleton className="mt-2 h-3 w-72" />
          <Skeleton className="mt-4 h-3 w-full" />
        </div>
      ))}
    </div>
  );
}

function InputLikeSelect({ value, onChange }: { value: ReviewTargetType; onChange: (value: ReviewTargetType) => void }) {
  return (
    <select id="targetType" className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground" value={value} onChange={(e) => onChange(e.target.value as ReviewTargetType)}>
      <option value="LEAD">Lead</option>
      <option value="CLIENT">Client</option>
      <option value="USER">User</option>
      <option value="FORM_FIELD">Form Field</option>
    </select>
  );
}
