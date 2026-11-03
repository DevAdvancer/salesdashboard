'use client';

import { CrmSelect } from '@/components/ui/crm-select';

import { useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/contexts/auth-context';
import { canShareProgress, normalizeProgressStatus, type ProgressEntry } from '@/lib/client-progress';
import type { SharedClientCard } from '@/lib/client-progress-share';
import { listClientProgressEventsAction, getClientCardShareStatusAction, publishClientCardAction, revokeClientCardAction } from '@/lib/services/client-progress-service';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ClientCardView } from './client-card-view';
import { formatEasternDateTime } from '@/lib/utils/eastern-date';

const options = { refetchInterval: false, refetchOnWindowFocus: false, refetchOnReconnect: false, retry: false } as const;
export function ClientCardDialog({ entry, sharing, onClose }: { entry: ProgressEntry; sharing: boolean; onClose: () => void }) {
  const { user } = useAuth(); const client = useQueryClient();
  const admin = !!user && canShareProgress(user), manage = sharing && admin;
  const [includeContact, setIncludeContact] = useState(false), [includeNotes, setIncludeNotes] = useState(true);
  const [days, setDays] = useState(7), [url, setUrl] = useState(''), [copied, setCopied] = useState(false);
  const feedback = useInfiniteQuery({ queryKey: ['client-progress', user?.$id, 'card-feedback', entry.$id],
    queryFn: ({ pageParam }) => listClientProgressEventsAction({ id: entry.$id, kind: 'feedback', order: 'oldest', ...(pageParam ? { cursor: pageParam } : {}) }),
    initialPageParam: undefined as string | undefined, getNextPageParam: page => page.nextCursor || undefined,
    staleTime: 0, ...options });
  const status = useQuery({ queryKey: ['client-progress', user?.$id, 'share-status', entry.$id], queryFn: () => getClientCardShareStatusAction(entry.$id), enabled: manage, staleTime: 0, ...options });
  const published = useMutation({ mutationFn: publishClientCardAction, onSuccess: async result => {
    setUrl(new URL(result.path, window.location.origin).href); setCopied(false);
    await client.invalidateQueries({ queryKey: ['client-progress', user?.$id, 'share-status', entry.$id] });
    await client.invalidateQueries({ queryKey: ['client-progress', user?.$id, 'events', entry.$id, 'audit'] });
  } });
  const revoked = useMutation({ mutationFn: revokeClientCardAction, onSuccess: async () => {
    setUrl(''); setCopied(false); await client.invalidateQueries({ queryKey: ['client-progress', user?.$id, 'share-status', entry.$id] });
    await client.invalidateQueries({ queryKey: ['client-progress', user?.$id, 'events', entry.$id, 'audit'] });
  } });
  const busy = published.isPending || revoked.isPending;
  const card: SharedClientCard = { candidateName: entry.candidateName, salespersonName: entry.salespersonName, marketingTl: entry.marketingTl,
    recruiterName: entry.recruiterName, progressStatus: normalizeProgressStatus(entry.progressStatus), enteredAt: entry.enteredAt,
    marketingStartedOn: entry.marketingStartedOn || '', finalFeedback: entry.finalFeedback, finalSavedAt: entry.finalSavedAt,
    ...(!manage || includeNotes ? { notes: entry.notes } : {}), ...(manage && includeContact ? { email: entry.email, phone: entry.phone } : {}) };
  const items = feedback.data?.pages.flatMap(page => page.events.map(event => ({ text: event.text, authorName: event.authorName, createdAt: event.$createdAt }))) || [];
  const error = feedback.error || status.error || published.error || revoked.error;
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}><DialogContent className="max-h-[90vh] overflow-y-auto border-border bg-card text-card-foreground sm:max-w-3xl">
    <DialogHeader className="sr-only"><DialogTitle>{manage ? 'Share client card' : 'Client card'}: {entry.candidateName}</DialogTitle><DialogDescription>{manage ? 'Review the selected client details before creating a public link.' : 'Client progress and feedback.'}</DialogDescription></DialogHeader>
    {manage && <div className="mb-2 space-y-3 rounded-xl border border-border bg-muted p-4"><h2 className="text-sm font-semibold">Share this client card</h2><p className="text-xs text-muted-foreground">Anyone with the link can view the selected client details and all current and future feedback. Recipients can forward or copy it. Only Admin can manage links.</p>
      <div className="flex flex-wrap gap-4 text-xs"><label className="flex items-center gap-2"><input type="checkbox" checked={includeNotes} disabled={busy} onChange={event => setIncludeNotes(event.target.checked)} />Include status remarks</label><label className="flex items-center gap-2"><input type="checkbox" checked={includeContact} disabled={busy} onChange={event => setIncludeContact(event.target.checked)} />Include email and phone</label><label className="flex items-center gap-2">Link expires<CrmSelect className="rounded border border-border bg-background px-2 py-1" value={days} disabled={busy} onChange={event => setDays(Number(event.target.value))}><option value={1}>In 1 day</option><option value={7}>In 7 days</option><option value={30}>In 30 days</option></CrmSelect></label></div>
      {status.data?.active && <p className="text-xs text-muted-foreground">An enabled link expires {formatEasternDateTime(status.data.expiresAt)} Eastern. It {status.data.includeNotes ? 'includes' : 'excludes'} remarks and {status.data.includeContact ? 'includes' : 'excludes'} contact details. Creating another link applies the selected options and replaces it. Revoking blocks future access.</p>}
      <div className="flex flex-wrap gap-2"><Button type="button" disabled={busy || feedback.isPending || !!feedback.error || status.isPending || !!status.error} onClick={() => published.mutate({ id: entry.$id, days, includeContact, includeNotes })}>{published.isPending ? 'Creating link…' : status.data?.active ? 'Replace share link' : 'Create share link'}</Button>{status.data?.active && <Button type="button" variant="outline" disabled={busy} onClick={() => revoked.mutate(entry.$id)}>{revoked.isPending ? 'Revoking…' : 'Revoke link'}</Button>}</div>
      {url && <div className="space-y-2"><label className="text-xs font-medium" htmlFor="public-card-link">Shareable link</label><Input id="public-card-link" value={url} readOnly onFocus={event => event.target.select()} /><div className="flex gap-2"><Button type="button" size="sm" variant="outline" onClick={async () => { try { await navigator.clipboard.writeText(url); setCopied(true); } catch { setCopied(false); } }}>{copied ? 'Link copied' : 'Copy link'}</Button><a className="rounded-md border border-border px-3 py-1.5 text-xs font-medium" href={url} target="_blank" rel="noopener noreferrer">Open card</a></div><p className="text-[10px] text-muted-foreground">Keep this link before closing. For security, the original link cannot be retrieved later; Admin can replace it.</p></div>}
    </div>}
    {error && <p role="alert" className="mb-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">{error instanceof Error ? error.message : 'Could not open this card.'}</p>}
    {feedback.isPending ? <p role="status" className="p-6 text-center text-sm text-muted-foreground">Loading client feedback…</p> : !feedback.error && <ClientCardView card={card} feedback={items} />}
    {feedback.hasNextPage && <Button type="button" variant="outline" className="mt-3" disabled={feedback.isFetchingNextPage} onClick={() => void feedback.fetchNextPage()}>{feedback.isFetchingNextPage ? 'Loading…' : 'Load more feedback'}</Button>}
  </DialogContent></Dialog>;
}
