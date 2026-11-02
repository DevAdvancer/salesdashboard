'use client';

import { useState, type FormEvent, type ReactNode } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Plus, Search, RotateCcw, BriefcaseBusiness, LockKeyhole, MessageSquare, Share2, ContactRound } from 'lucide-react';
import { useAuth } from '@/lib/contexts/auth-context';
import { ProtectedRoute } from '@/components/protected-route';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { PROGRESS_STATUSES, normalizeProgressStatus, canShareProgress, canManageProgress, canManageMarketingTl, canEditProgress, canSaveFinalFeedback, isProgressEligible, type ProgressFilters, type ProgressEntry } from '@/lib/client-progress';
import { DatePicker } from '@/components/ui/date-picker';
import { ClientCardDialog } from '@/components/client-progress/client-card-dialog';
import { fetchClientProgress, getClientProgressAction, createManualProgressAction, updateClientProgressAction, searchProgressSalespeopleAction, addClientProgressFeedbackAction, listClientProgressEventsAction } from '@/lib/services/client-progress-service';
import { formatEasternCalendarDate, formatEasternDateTime } from '@/lib/utils/eastern-date';

const queryOptions = { staleTime: 0, refetchInterval: false, refetchOnWindowFocus: false, refetchOnReconnect: false, refetchOnMount: 'always', retry: false } as const;
const listQueryOptions = { ...queryOptions, staleTime: 60_000, refetchOnMount: true } as const;
const selectClass = 'h-10 w-full rounded-md border border-input bg-background px-3 text-sm';
const emptyFilters: ProgressFilters = { search: '', status: '', salesperson: '', marketingTl: '', recruiter: '', from: '', to: '' };
function Field({ label, children }: { label: string; children: ReactNode }) { return <label className="grid gap-2 text-sm font-medium"><span>{label}</span>{children}</label>; }
function ErrorNotice({ error }: { error: unknown }) { return error ? <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error instanceof Error ? error.message : 'Something went wrong. Please retry.'}</p> : null; }
function Status({ value }: { value: string }) {
  const label = normalizeProgressStatus(value);
  const color = label === 'Placed' ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
    : label === 'Hold' || label === 'Temp Hold' ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300'
    : label === 'Low priority' ? 'bg-muted text-muted-foreground'
    : label === 'Backout' ? 'bg-destructive/10 text-destructive' : 'bg-primary/10 text-primary';
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${color}`}>{label}</span>;
}

function SalespersonPicker({ value, onChange, disabled }: { value: { id: string; name: string }; onChange: (value: { id: string; name: string }) => void; disabled?: boolean }) {
  const { user } = useAuth();
  const [search, setSearch] = useState('');
  const [submitted, setSubmitted] = useState<string | null>(null);
  const result = useQuery({ queryKey: ['client-progress', user?.$id, 'salespeople', submitted], queryFn: () => searchProgressSalespeopleAction(submitted || ''), enabled: submitted !== null && !disabled, ...queryOptions });
  return <div className="space-y-2">
    <Label htmlFor="salesperson-search">Salesperson</Label>
    <div className="flex gap-2"><Input id="salesperson-search" value={search} disabled={disabled} placeholder="Find a Sales admin, agent or TL" maxLength={100} onChange={event => setSearch(event.target.value)} /><Button type="button" variant="outline" disabled={disabled || result.isFetching} onClick={() => { if (submitted === search) void result.refetch(); else setSubmitted(search); }}>Find</Button></div>
    <p className="text-sm text-muted-foreground">Selected: <strong className="text-foreground">{value.name || 'Choose a salesperson'}</strong></p>
    <ErrorNotice error={result.error} />
    {result.data && <div className="max-h-36 overflow-y-auto rounded-md border">{result.data.length ? result.data.map(person => <button key={person.id} type="button" disabled={disabled} className="block w-full px-3 py-2 text-left text-sm hover:bg-muted" onClick={() => { onChange(person); setSubmitted(null); }}>{person.name} <span className="text-muted-foreground">· {person.role.replaceAll('_', ' ')}</span></button>) : <p className="p-3 text-sm text-muted-foreground">No matching Sales users.</p>}</div>}
  </div>;
}

function NewCandidate({ onCreated, onClose }: { onCreated: (id: string) => void; onClose: () => void }) {
  const { user } = useAuth();
  const [id] = useState(() => crypto.randomUUID());
  const [person, setPerson] = useState({ id: '', name: '' });
  const mutation = useMutation({ mutationFn: createManualProgressAction, onSuccess: onCreated });
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    mutation.mutate({ id, candidateName: String(data.get('candidateName') || ''), email: String(data.get('email') || ''), phone: String(data.get('phone') || ''),
      salespersonId: person.id, marketingTl: String(data.get('marketingTl') || ''), recruiterName: String(data.get('recruiterName') || ''), notes: String(data.get('notes') || '') });
  };
  return <Dialog open onOpenChange={open => { if (!open && !mutation.isPending) onClose(); }}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl"><DialogHeader><DialogTitle>Add candidate</DialogTitle><DialogDescription>Create a manual entry and assign it to a Sales user.</DialogDescription></DialogHeader>
    <form onSubmit={submit} className="space-y-5"><fieldset disabled={mutation.isPending} className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2"><Field label="Candidate name"><Input name="candidateName" required maxLength={200} /></Field><Field label="Email"><Input name="email" type="email" maxLength={320} /></Field><Field label="Phone"><Input name="phone" maxLength={80} /></Field><Field label="Recruiter name"><Input name="recruiterName" maxLength={200} /></Field>{user && canManageMarketingTl(user) && <Field label="Marketing TL"><Input name="marketingTl" maxLength={200} /></Field>}</div>
      <SalespersonPicker value={person} onChange={setPerson} disabled={mutation.isPending} />
      <Field label="Notes"><Textarea name="notes" maxLength={5000} rows={3} /></Field>
    </fieldset><ErrorNotice error={mutation.error} /><div className="flex justify-end gap-2"><Button type="button" variant="outline" disabled={mutation.isPending} onClick={onClose}>Cancel</Button><Button type="submit" disabled={mutation.isPending || !person.id}>{mutation.isPending ? 'Creating…' : 'Create candidate'}</Button></div></form>
  </DialogContent></Dialog>;
}

function Events({ id, kind }: { id: string; kind: 'feedback' | 'audit' }) {
  const { user } = useAuth();
  const [cursors, setCursors] = useState<Array<string | undefined>>([undefined]);
  const cursor = cursors.at(-1);
  const query = useQuery({ queryKey: ['client-progress', user?.$id, 'events', id, kind, cursor], queryFn: () => listClientProgressEventsAction({ id, kind, cursor }), ...queryOptions });
  return <div className="space-y-3"><ErrorNotice error={query.error} />
    {query.isFetching ? <p role="status" className="text-sm text-muted-foreground">Loading {kind === 'audit' ? 'history' : 'feedback'}…</p> : query.data?.events.length ? query.data.events.map(event => <article key={event.$id} className="rounded-lg border p-4"><p className="mb-2 text-xs text-muted-foreground">{event.authorName} · {formatEasternDateTime(event.$createdAt)}</p><p className="whitespace-pre-wrap break-words text-sm">{kind === 'audit' ? describeAudit(event.text) : event.text}</p></article>) : !query.error && <p className="py-4 text-sm text-muted-foreground">No {kind === 'audit' ? 'changes' : 'feedback'} yet.</p>}
    <div className="flex justify-end gap-2"><Button size="sm" variant="outline" disabled={cursors.length === 1 || query.isFetching} onClick={() => setCursors(current => current.slice(0, -1))}>Newer</Button><Button size="sm" variant="outline" disabled={!query.data?.nextCursor || query.isFetching} onClick={() => setCursors(current => [...current, query.data!.nextCursor!])}>Older</Button></div>
  </div>;
}
function describeAudit(text: string) {
  try {
    const event = JSON.parse(text) as { action: string; changes: Record<string, unknown> };
    const actions: Record<string, string> = { CREATE_ATTEMPT: 'Candidate creation started', CREATE: 'Candidate created', UPDATE_ATTEMPT: 'Changes submitted', UPDATE: 'Changes saved' };
    const labels: Record<string, string> = { candidateName: 'Candidate', salespersonName: 'Salesperson', department: 'Department', progressStatus: 'Progress status', marketingTl: 'Marketing TL', recruiterName: 'Recruiter', notes: 'Notes', finalFeedback: 'Final feedback', finalSavedAt: 'Final feedback first saved' };
    const display = (value: unknown): string => {
      if (value == null || value === '') return 'Empty';
      if (typeof value === 'object' && 'preview' in value) return `${String(value.preview)}…`;
      return String(value);
    };
    const changes = Object.entries(event.changes).map(([field, value]) => {
      if (field === 'salespersonId') return 'Salesperson assignment updated';
      const label = labels[field] || 'Client details';
      if (value && typeof value === 'object' && 'from' in value && 'to' in value) return `${label}: ${display(value.from)} → ${display(value.to)}`;
      return `${label}: ${display(value)}`;
    });
    return `${actions[event.action] || 'Client updated'}\n${changes.join('\n')}`;
  }
  catch { return text; }
}

function ProgressEditor({ entry, onSaved }: { entry: ProgressEntry; onSaved: (removed: boolean) => Promise<void> }) {
  const { user } = useAuth();
  const [person, setPerson] = useState({ id: entry.salespersonId, name: entry.salespersonName });
  const [status, setStatus] = useState(normalizeProgressStatus(entry.progressStatus));
  const [marketingStartedOn, setMarketingStartedOn] = useState(entry.marketingStartedOn || '');
  const mutation = useMutation({ mutationFn: updateClientProgressAction, onSuccess: () => onSaved(!isProgressEligible(status)) });
  if (!user) return null;
  const editable = canEditProgress(user), admin = canManageProgress(user), finalEditable = canSaveFinalFeedback(user, !!entry.finalSavedAt);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const data = new FormData(event.currentTarget); const patch: Record<string, string> = {};
    const fields = ['notes', ...(admin ? ['recruiterName'] : []), ...(canManageMarketingTl(user) ? ['marketingTl'] : []), ...(finalEditable ? ['finalFeedback'] : [])] as Array<'notes' | 'recruiterName' | 'marketingTl' | 'finalFeedback'>;
    for (const field of fields) { const value = String(data.get(field) || '').trim(); if (value !== entry[field]) patch[field] = value; }
    if (status !== normalizeProgressStatus(entry.progressStatus)) patch.progressStatus = status;
    if (admin && person.id !== entry.salespersonId) patch.salespersonId = person.id;
    if (admin && marketingStartedOn !== (entry.marketingStartedOn || '')) patch.marketingStartedOn = marketingStartedOn;
    if (Object.keys(patch).length) mutation.mutate({ id: entry.$id, version: entry.$updatedAt, patch });
  };
  return <form onSubmit={submit} className="space-y-5"><fieldset disabled={mutation.isPending || !editable} className="space-y-5">
    <div className="grid gap-4 sm:grid-cols-2"><Field label="Progress status"><select className={selectClass} value={status} onChange={event => setStatus(event.target.value as typeof status)}>{PROGRESS_STATUSES.map(value => <option key={value}>{value}</option>)}</select></Field><Field label="Marketing TL"><Input name="marketingTl" defaultValue={entry.marketingTl} readOnly={!canManageMarketingTl(user)} maxLength={200} placeholder="Sales Admin entry" /></Field><Field label="Recruiter name"><Input name="recruiterName" defaultValue={entry.recruiterName} readOnly={!admin} maxLength={200} placeholder="Admin entry" /></Field><Field label="Salesperson"><Input value={person.name} readOnly /></Field></div>
    {admin && <SalespersonPicker value={person} onChange={setPerson} disabled={mutation.isPending} />}
    <div className="grid gap-2"><Label htmlFor="marketing-started-on">Marketing started (Eastern)</Label><DatePicker id="marketing-started-on" value={marketingStartedOn} onChange={setMarketingStartedOn} disabled={!admin || mutation.isPending} placeholder="Not recorded" /><p className="text-xs text-muted-foreground">Recorded automatically when marketing begins. Admin can choose or correct the date.</p></div>
    <Field label="Status comment / remarks"><Textarea name="notes" defaultValue={entry.notes} maxLength={5000} rows={4} /></Field>
    <div className="space-y-2 rounded-xl border bg-muted/20 p-4"><div className="flex items-center gap-2"><LockKeyhole className="size-4 text-muted-foreground" /><Label htmlFor="final-feedback">Final feedback</Label></div><p className="text-xs text-muted-foreground">{entry.finalSavedAt ? `Saved ${formatEasternDateTime(entry.finalSavedAt)}. Only Admin can edit this feedback.` : 'After the first save, only Admin can edit final feedback.'}</p><Textarea id="final-feedback" name="finalFeedback" defaultValue={entry.finalFeedback} readOnly={!finalEditable} maxLength={5000} rows={4} /></div>
  </fieldset>{!isProgressEligible(status) && <p className="text-sm text-amber-700 dark:text-amber-300">Saving this status removes the entry from Client Progress. Its history is retained.</p>}<ErrorNotice error={mutation.error} />{editable && <Button disabled={mutation.isPending}>{mutation.isPending ? 'Saving…' : 'Save changes'}</Button>}</form>;
}

function FeedbackForm({ id }: { id: string }) {
  const { user } = useAuth(); const queryClient = useQueryClient();
  const [text, setText] = useState(''); const [feedbackId, setFeedbackId] = useState(() => crypto.randomUUID());
  const mutation = useMutation({ mutationFn: addClientProgressFeedbackAction, onSuccess: async () => {
    setText(''); setFeedbackId(crypto.randomUUID()); await queryClient.invalidateQueries({ queryKey: ['client-progress', user?.$id, 'events', id, 'feedback'] });
  } });
  if (!user || !canEditProgress(user)) return null;
  return <form className="space-y-3 rounded-xl bg-muted/30 p-4" onSubmit={event => { event.preventDefault(); mutation.mutate({ id, feedbackId, text }); }}><Label htmlFor="new-feedback">Add feedback</Label><Textarea id="new-feedback" placeholder="Add an update to the timeline…" value={text} onChange={event => setText(event.target.value)} maxLength={5000} required disabled={mutation.isPending} /><p className="text-xs text-muted-foreground">Each save preserves previous feedback. Feedback may appear on an Admin-shared client card.</p><ErrorNotice error={mutation.error} /><Button disabled={!text.trim() || mutation.isPending}><MessageSquare className="mr-2 size-4" />{mutation.isPending ? 'Adding…' : 'Add feedback'}</Button></form>;
}

function EntryDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const { user } = useAuth(); const client = useQueryClient(); const [tab, setTab] = useState<'feedback' | 'audit'>('feedback');
  const [cardMode, setCardMode] = useState<'view' | 'share' | null>(null);
  const query = useQuery({ queryKey: ['client-progress', user?.$id, 'detail', id, user?.role, user?.department], queryFn: () => getClientProgressAction(id), ...queryOptions });
  const saved = async (removed: boolean) => {
    await client.invalidateQueries({ queryKey: ['client-progress', user?.$id, 'list'], refetchType: 'none' });
    if (removed) { onBack(); return; }
    await Promise.all([
      client.invalidateQueries({ queryKey: ['client-progress', user?.$id, 'detail', id] }),
      client.invalidateQueries({ queryKey: ['client-progress', user?.$id, 'events', id, 'audit'] }),
    ]);
  };
  return <div className="space-y-6"><div className="flex flex-wrap justify-between gap-3"><Button variant="ghost" onClick={onBack}><ArrowLeft className="mr-2 size-4" />Back to clients</Button>{query.data && !query.error && <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => setCardMode('view')}><ContactRound className="mr-2 size-4" />View client card</Button>{user && canShareProgress(user) && <Button onClick={() => setCardMode('share')}><Share2 className="mr-2 size-4" />Share client card</Button>}</div>}</div><ErrorNotice error={query.error} />
    {query.isPending ? <p role="status">Loading client…</p> : query.data && !query.error && <><header><div className="mb-2 flex flex-wrap items-center gap-3"><h1 className="text-3xl font-bold">{query.data.candidateName}</h1><Status value={query.data.progressStatus} /></div><p className="text-sm text-muted-foreground">{query.data.email || 'No email'} · {query.data.phone || 'No phone'} · {query.data.source === 'manual' ? 'Manual candidate' : 'Closed client'} · Added {formatEasternCalendarDate(query.data.enteredAt)}</p></header><div className="grid items-start gap-6 xl:grid-cols-2"><Card className="p-5 md:p-6"><h2 className="mb-5 text-lg font-semibold">Client details</h2><ProgressEditor key={query.data.$updatedAt} entry={query.data} onSaved={saved} /></Card><Card className="space-y-5 p-5 md:p-6"><div className="flex gap-2"><Button variant={tab === 'feedback' ? 'default' : 'outline'} onClick={() => setTab('feedback')}>Feedback</Button><Button variant={tab === 'audit' ? 'default' : 'outline'} onClick={() => setTab('audit')}>Change history</Button></div>{tab === 'feedback' && <FeedbackForm id={id} />}<Events key={tab} id={id} kind={tab} /></Card></div></>}
    {cardMode && query.data && !query.error && <ClientCardDialog entry={query.data} sharing={cardMode === 'share'} onClose={() => setCardMode(null)} />}
  </div>;
}

function ClientProgressContent() {
  const { user } = useAuth(); const client = useQueryClient();
  const [draft, setDraft] = useState<ProgressFilters>(emptyFilters); const [filters, setFilters] = useState<ProgressFilters>(emptyFilters);
  const [selectedId, setSelectedId] = useState<string | null>(null); const [creating, setCreating] = useState(false);
  const query = useQuery({ queryKey: ['client-progress', user?.$id, 'list', user?.role, user?.department, filters],
    queryFn: ({ signal }) => fetchClientProgress(filters, signal), enabled: !!user && !selectedId, ...listQueryOptions });
  const reset = () => { setDraft(emptyFilters); setFilters(emptyFilters); };
  const change = (key: keyof ProgressFilters, value: string) => setDraft(current => ({ ...current, [key]: value }));
  if (!user) return null;
  if (selectedId) return <EntryDetail key={selectedId} id={selectedId} onBack={() => setSelectedId(null)} />;
  return <div className="space-y-6"><header className="flex flex-wrap items-center justify-between gap-4"><div><p className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">Client operations</p><h1 className="text-3xl font-bold tracking-tight">Client Progress</h1><p className="mt-2 text-sm text-muted-foreground">Track closed clients, candidate assignments, and feedback in one place.</p></div>{canManageProgress(user) && <Button onClick={() => setCreating(true)}><Plus className="mr-2 size-4" />Add candidate</Button>}</header>
    <Card className="p-5"><form className="space-y-4" onSubmit={event => { event.preventDefault(); setFilters({ ...draft }); if (JSON.stringify(filters) === JSON.stringify(draft)) void query.refetch(); }}><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Field label="Search clients"><Input value={draft.search} onChange={event => change('search', event.target.value)} maxLength={100} placeholder="Search candidate name" /></Field><Field label="Progress status"><select className={selectClass} value={draft.status} onChange={event => change('status', event.target.value)}><option value="">All active statuses</option>{PROGRESS_STATUSES.filter(isProgressEligible).map(status => <option key={status}>{status}</option>)}</select></Field>
      <Field label="Salesperson"><Input value={draft.salesperson} onChange={event => change('salesperson', event.target.value)} maxLength={100} placeholder="Search salesperson" /></Field><Field label="Marketing TL"><Input value={draft.marketingTl} onChange={event => change('marketingTl', event.target.value)} maxLength={100} placeholder="Search Marketing TL" /></Field><Field label="Recruiter"><Input value={draft.recruiter} onChange={event => change('recruiter', event.target.value)} maxLength={100} placeholder="Search recruiter" /></Field><div className="grid gap-2"><Label htmlFor="progress-date-from">Added from (Eastern)</Label><DatePicker id="progress-date-from" value={draft.from || ''} onChange={value => change('from', value)} maxDate={draft.to || undefined} /></div><div className="grid gap-2"><Label htmlFor="progress-date-to">Added to (Eastern)</Label><DatePicker id="progress-date-to" value={draft.to || ''} onChange={value => change('to', value)} minDate={draft.from || undefined} /></div>
    </div><div className="flex flex-wrap items-center gap-2 border-t pt-4"><Button><Search className="mr-2 size-4" />Apply filters</Button><Button type="button" variant="outline" onClick={reset}><RotateCcw className="mr-2 size-4" />Reset</Button><span className="ml-auto text-xs text-muted-foreground">Latest 10 · Search to find an older client</span></div></form></Card>
    <ErrorNotice error={query.error} /><Card className="overflow-hidden"><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-muted/40 text-xs text-muted-foreground"><tr>{['Candidate / Client', 'Salesperson', 'Marketing TL', 'Recruiter', 'Progress', 'Added', ''].map((label, i) => <th key={i} className="whitespace-nowrap px-5 py-4 font-medium">{label}</th>)}</tr></thead><tbody>
      {query.isPending ? <tr><td colSpan={7} className="p-12 text-center text-muted-foreground" role="status">Loading clients…</td></tr> : !query.error && query.data?.entries.length ? query.data.entries.map(entry => <tr key={entry.$id} className="border-t transition-colors hover:bg-muted/20"><td className="px-5 py-4"><button className="font-semibold hover:underline" onClick={() => setSelectedId(entry.$id)}>{entry.candidateName}</button><p className="mt-1 text-xs text-muted-foreground">{entry.email || entry.phone || 'No contact details'}</p><span className="mt-1 inline-block text-xs text-muted-foreground">{entry.source === 'manual' ? 'Manual' : 'Closed client'}</span></td><td className="px-5 py-4">{entry.salespersonName || '—'}</td><td className="px-5 py-4">{entry.marketingTl || '—'}</td><td className="px-5 py-4">{entry.recruiterName || '—'}</td><td className="whitespace-nowrap px-5 py-4"><Status value={entry.progressStatus} /></td><td className="whitespace-nowrap px-5 py-4 text-muted-foreground">{formatEasternCalendarDate(entry.enteredAt)}</td><td className="px-5 py-4"><Button size="sm" variant="outline" onClick={() => setSelectedId(entry.$id)}>View</Button></td></tr>) : <tr><td colSpan={7} className="p-12 text-center"><BriefcaseBusiness className="mx-auto mb-3 size-8 text-muted-foreground" /><p className="font-medium">{query.error ? 'Could not load clients' : 'No matching clients'}</p><p className="mt-1 text-sm text-muted-foreground">{query.error ? 'Apply the filters to try again.' : 'Try changing or resetting your filters.'}</p></td></tr>}
    </tbody></table></div><footer className="flex items-center justify-between gap-3 border-t px-5 py-4"><span className="text-xs text-muted-foreground">{query.error ? '—' : query.data?.entries.length || 0} entries · Maximum 10 results</span>{query.isFetching && !query.isPending && <span role="status" className="text-xs text-muted-foreground">Updating…</span>}</footer></Card>
    {creating && <NewCandidate onClose={() => setCreating(false)} onCreated={id => { setCreating(false); setSelectedId(id); void client.invalidateQueries({ queryKey: ['client-progress', user.$id, 'list'] }); }} />}
  </div>;
}

export default function ClientProgressPage() { return <ProtectedRoute componentKey="client-progress"><ClientProgressContent /></ProtectedRoute>; }
