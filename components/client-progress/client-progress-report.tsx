'use client';

import { useId, useState } from 'react';
import { QueryClient, QueryClientProvider, useInfiniteQuery, useMutation, useQuery } from '@tanstack/react-query';
import { subDays } from 'date-fns';
import { BriefcaseBusiness, CalendarDays, ChevronDown, Download, MessageSquare, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { DatePicker } from '@/components/ui/date-picker';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { matchesProgressReportClient, type ProgressReportClient, type ProgressReportFeedback, type ProgressReportPerson, type ProgressReportRange, type ProgressReportRequest, type ProgressReportSummary } from '@/lib/client-progress-report';
import { formatEasternCalendarDate, formatEasternDateTime, getCurrentEasternIsoDate } from '@/lib/utils/eastern-date';
import { calendarMonthWindow, reportingPeriodThroughToday } from '@/lib/utils/reporting-period';

const queryOptions = {
  staleTime: 30_000, gcTime: 120_000, retry: false, refetchInterval: false,
  refetchOnWindowFocus: false, refetchOnReconnect: false,
} as const;

const dateFilters = [
  { id: 'day', label: '1 day' },
  { id: 'week', label: 'Last 7 days' },
  { id: 'fortnight', label: 'Last 15 days' },
  { id: 'month', label: 'Monthly' },
  { id: 'custom', label: 'Custom range' },
] as const;
type DateFilter = (typeof dateFilters)[number]['id'];
const presetDays = { day: 1, week: 7, fortnight: 15 } as const;

function recentDays(today: string, days: number): ProgressReportRange {
  return { from: getCurrentEasternIsoDate(subDays(new Date(`${today}T12:00:00Z`), days - 1)), to: today };
}

async function requestReport(input: ProgressReportRequest) {
  // Let reads finish so switching back to a filter can reuse an in-flight result.
  const response = await fetch('/api/client-progress/report', {
    method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (response.status === 401 || response.status === 403) window.dispatchEvent(new Event('crm-access-recheck'));
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error || 'Could not load the report. Please retry.');
  }
  return response;
}

async function downloadReport(range: ProgressReportRange, authorId?: string, search?: string) {
  const response = await requestReport({ view: 'export', range, authorId, search });
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = `client-progress-${range.from}-to-${range.to}.csv`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function ReportError({ error }: { error: Error | null }) {
  return error && <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error.message}</p>;
}

function ClientFeedback({ userId, range, authorId, entryId }: { userId: string; range: ProgressReportRange; authorId: string; entryId: string }) {
  const query = useInfiniteQuery({
    queryKey: ['client-progress-report', userId, 'feedback', range, authorId, entryId],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }): Promise<ProgressReportFeedback> => (await requestReport({ view: 'feedback', range, authorId, entryId, cursor: pageParam })).json(),
    getNextPageParam: page => page.nextCursor ?? undefined,
    ...queryOptions,
  });
  const entries = query.data?.pages.flatMap(page => page.entries) ?? [];
  return <div className="space-y-3 border-t bg-muted/20 px-5 py-4">
    <ReportError error={query.error} />
    {query.isPending && <p role="status" className="text-sm text-muted-foreground">Loading feedback…</p>}
    {!query.error && !query.isPending && !entries.length && <p className="text-sm text-muted-foreground">No feedback for this client in the selected range.</p>}
    {entries.length > 0 && <ol className="divide-y">
      {entries.map(entry => <li key={entry.$id} className="space-y-1 py-3 first:pt-0 last:pb-0">
        <time dateTime={entry.$createdAt} className="text-xs font-medium text-muted-foreground">{formatEasternDateTime(entry.$createdAt)} ET</time>
        <p className="whitespace-pre-wrap break-words text-sm">{entry.text}</p>
      </li>)}
    </ol>}
    {query.hasNextPage && <Button type="button" variant="outline" size="sm" disabled={query.isFetching} onClick={() => void query.fetchNextPage()}>Load more feedback</Button>}
    {query.isError && !query.data && <Button type="button" variant="outline" size="sm" onClick={() => void query.refetch()}>Retry</Button>}
  </div>;
}

function PersonClients({ userId, range, person, search, onSearch }: {
  userId: string; range: ProgressReportRange; person: ProgressReportPerson; search: string; onSearch: (search: string) => void;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const searchId = useId();
  const query = useQuery({
    queryKey: ['client-progress-report', userId, 'person', range, person.id],
    queryFn: async (): Promise<ProgressReportClient[]> => (await requestReport({ view: 'person', range, authorId: person.id })).json(),
    ...queryOptions,
  });
  const clients = query.data?.filter(client => matchesProgressReportClient(client.name, search)) ?? [];
  return <Card className="gap-0 overflow-hidden py-0" aria-label={`${person.name} client updates`}>
    <div className="flex flex-wrap items-end justify-between gap-3 p-5">
      <div><h3 className="text-lg font-semibold">Client updates by {person.name}</h3>
        <p className="text-sm text-muted-foreground">{person.clientCount} {person.clientCount === 1 ? 'client' : 'clients'} · {person.feedbackCount} feedback {person.feedbackCount === 1 ? 'entry' : 'entries'}</p>
      </div>
      <div className="grid w-full gap-2 sm:w-56">
        <Label htmlFor={searchId}>Search client names</Label>
        <Input id={searchId} type="search" value={search} maxLength={200} onChange={event => { onSearch(event.target.value); setExpanded(null); }} />
      </div>
    </div>
    {query.error && <div className="space-y-3 px-5 pb-5"><ReportError error={query.error} /><Button size="sm" variant="outline" onClick={() => void query.refetch()}>Retry</Button></div>}
    {query.isPending && <p role="status" className="px-5 pb-5 text-sm text-muted-foreground">Loading clients…</p>}
    {!query.error && !query.isPending && !clients.length && <p className="px-5 pb-5 text-sm text-muted-foreground">No matching clients.</p>}
    <ul className="divide-y">
      {clients.map(client => <li key={client.id} className="first:border-t">
        <button type="button" aria-expanded={expanded === client.id} className="flex w-full items-center gap-3 px-5 py-4 text-left text-sm hover:bg-muted/40 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring" onClick={() => setExpanded(value => value === client.id ? null : client.id)}>
          <span className="grow break-words font-medium">{client.name}</span>
          <span className="shrink-0 tabular-nums text-muted-foreground">{client.feedbackCount} {client.feedbackCount === 1 ? 'entry' : 'entries'}</span>
          <ChevronDown aria-hidden="true" className={`size-4 shrink-0 transition-transform ${expanded === client.id ? 'rotate-180' : ''}`} />
        </button>
        {expanded === client.id && <ClientFeedback userId={userId} range={range} authorId={person.id} entryId={client.id} />}
      </li>)}
    </ul>
  </Card>;
}

export function ClientProgressReport({ userId }: { userId: string }) {
  // The main CRM cache is persisted to IndexedDB. Report data only lives in memory.
  const [queryClient] = useState(() => new QueryClient());
  return <QueryClientProvider client={queryClient}><FilteredReport userId={userId} /></QueryClientProvider>;
}

function FilteredReport({ userId }: { userId: string }) {
  const today = getCurrentEasternIsoDate();
  const currentMonth = today.slice(0, 7);
  const [filter, setFilter] = useState<DateFilter>('week');
  const [month, setMonth] = useState(currentMonth);
  const [custom, setCustom] = useState<ProgressReportRange>();
  const id = useId();
  let range: ProgressReportRange | undefined;
  if (filter === 'month') range = reportingPeriodThroughToday(calendarMonthWindow(month), today);
  else if (filter === 'custom') range = custom;
  else range = recentDays(today, presetDays[filter]);

  return <div className="space-y-5">
    <Card className="rounded-2xl shadow-none">
      <div className="flex flex-col gap-3 p-4 sm:flex-row sm:flex-wrap sm:items-center sm:gap-4 sm:px-5">
        <div id={id} className="flex items-center gap-2 text-sm font-semibold">
          <CalendarDays aria-hidden="true" className="size-4 text-muted-foreground" /> Date range
        </div>
        <div role="group" aria-labelledby={id} className="flex flex-wrap gap-1 rounded-xl border border-border/60 bg-muted/30 p-1">
          {dateFilters.map(({ id, label }) => <button key={id} type="button" aria-pressed={id === filter} onClick={() => setFilter(id)} className={cn(
            'rounded-lg px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-ring',
            id === filter ? 'bg-sky-500/15 text-sky-800 shadow-sm dark:text-sky-300' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
          )}>{label}</button>)}
        </div>
      </div>
      {filter === 'month' && <MonthFilter month={month} currentMonth={currentMonth} onApply={setMonth} />}
      {filter === 'custom' && <CustomDateFilter initialRange={custom ?? recentDays(today, 7)} appliedRange={custom} onApply={setCustom} />}
    </Card>
    {range && <ReportDashboard key={`${range.from}:${range.to}`} userId={userId} range={range} />}
  </div>;
}

function MonthFilter({ month, currentMonth, onApply }: { month: string; currentMonth: string; onApply: (month: string) => void }) {
  const [draft, setDraft] = useState(month);
  const monthId = useId();
  const canApply = /^\d{4}-(0[1-9]|1[0-2])$/.test(draft) && draft <= currentMonth;
  return <form className="flex flex-wrap items-end gap-3 border-t border-border/60 px-4 py-3 sm:px-5" onSubmit={event => { event.preventDefault(); if (canApply) onApply(draft); }}>
    <div className="grid gap-2"><Label htmlFor={monthId}>Month</Label><Input id={monthId} type="month" value={draft} max={currentMonth} onChange={event => setDraft(event.target.value)} /></div>
    <Button disabled={!canApply || draft === month}>Apply month</Button>
  </form>;
}

function CustomDateFilter({ initialRange, appliedRange, onApply }: {
  initialRange: ProgressReportRange; appliedRange?: ProgressReportRange; onApply: (range: ProgressReportRange) => void;
}) {
  const [draft, setDraft] = useState(initialRange);
  const id = useId();
  const canApply = draft.from && draft.to && draft.from <= draft.to;
  return <form className="flex flex-wrap items-end gap-3 border-t border-border/60 px-4 py-3 sm:px-5" onSubmit={event => { event.preventDefault(); if (canApply) onApply(draft); }}>
    <div className="grid gap-2"><Label htmlFor={`${id}-from`}>Updated from</Label><DatePicker id={`${id}-from`} value={draft.from} maxDate={draft.to || undefined} onChange={from => setDraft(value => ({ ...value, from }))} /></div>
    <div className="grid gap-2"><Label htmlFor={`${id}-to`}>Updated through</Label><DatePicker id={`${id}-to`} value={draft.to} minDate={draft.from || undefined} onChange={to => setDraft(value => ({ ...value, to }))} /></div>
    <Button disabled={!canApply || (draft.from === appliedRange?.from && draft.to === appliedRange.to)}>Apply dates</Button>
  </form>;
}

function ReportDashboard({ userId, range }: { userId: string; range: ProgressReportRange }) {
  const [authorId, setAuthorId] = useState<string>();
  const [search, setSearch] = useState('');
  const summary = useQuery({
    queryKey: ['client-progress-report', userId, 'summary', range],
    queryFn: async (): Promise<ProgressReportSummary> => (await requestReport({ view: 'summary', range })).json(),
    ...queryOptions,
  });
  const csv = useMutation({ mutationFn: () => downloadReport(range, authorId, authorId ? search : undefined), retry: false });
  const totals = summary.data;
  const person = totals?.people.find(row => row.id === authorId);
  const startDate = formatEasternCalendarDate(range.from);
  const dateLabel = range.from === range.to ? startDate : `${startDate} – ${formatEasternCalendarDate(range.to)}`;
  const metrics = [
    { label: 'Unique clients updated', value: totals?.clientCount, Icon: BriefcaseBusiness },
    { label: 'Feedback entries', value: totals?.feedbackCount, Icon: MessageSquare },
    { label: 'People who posted', value: totals?.people.length, Icon: Users },
  ];

  return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 className="text-base font-semibold">Feedback overview</h2>
        <p className="text-sm text-muted-foreground">{dateLabel} · Eastern time</p>
      </div>
      <Button type="button" variant="outline" className="gap-2" disabled={!totals?.feedbackCount || summary.isFetching || csv.isPending} onClick={() => csv.mutate()}><Download className="size-4" aria-hidden="true" />{csv.isPending ? 'Preparing CSV…' : person ? `Export ${person.name}` : 'Export CSV'}</Button>
    </div>
    <ReportError error={csv.error} />
    {summary.error && <div className="space-y-2"><ReportError error={summary.error} /><Button variant="outline" size="sm" onClick={() => void summary.refetch()}>Retry report</Button></div>}
    {summary.isFetching && <p role="status" className="sr-only">Loading report…</p>}
    <div className="grid gap-3 sm:grid-cols-3" aria-busy={summary.isPending}>
      {metrics.map(({ label, value, Icon }, index) => <Card key={label} className={cn('rounded-2xl p-4 shadow-none sm:p-5', index === 0 && 'border-sky-500/25')}>
        <div className="flex items-center justify-between gap-3">
          <div className="space-y-1"><p className="text-sm font-medium text-muted-foreground">{label}</p>
            {summary.isPending ? <div className="my-2 h-6 w-12 animate-pulse rounded-md bg-muted motion-reduce:animate-none" /> : <p className="text-3xl font-semibold tabular-nums">{value?.toLocaleString() ?? '—'}</p>}
          </div>
          <span className={cn('grid size-9 shrink-0 place-items-center rounded-lg', index === 0 ? 'bg-sky-500/15 text-sky-700 dark:text-sky-300' : 'bg-muted text-muted-foreground')}><Icon aria-hidden="true" className="size-4" /></span>
        </div>
      </Card>)}
    </div>
    {totals && <Card className="overflow-hidden rounded-2xl shadow-none">
      <div className="flex flex-wrap items-center justify-between gap-2 p-5">
        <div><h3 className="text-lg font-semibold">Updates by person</h3><p className="text-sm text-muted-foreground">Select a person to see their clients and feedback.</p></div>
        {person && <Button type="button" variant="outline" size="sm" onClick={() => { setAuthorId(undefined); setSearch(''); }}>Clear person selection</Button>}
      </div>
      {totals.people.length ? <div className="overflow-x-auto"><table className="w-full text-left text-sm">
        <thead className="bg-muted/40 text-muted-foreground"><tr><th scope="col" className="px-5 py-3 font-medium">Posted by</th><th scope="col" className="px-5 py-3 font-medium">Unique clients</th><th scope="col" className="px-5 py-3 font-medium">Feedback entries</th></tr></thead>
        <tbody>{totals.people.map(row => <tr key={row.id} className={row.id === person?.id ? 'border-t bg-primary/5' : 'border-t'}>
          <td className="px-5 py-2"><Button variant="link" type="button" className="h-auto whitespace-normal px-0 text-left font-semibold" aria-pressed={row.id === person?.id} onClick={() => { setAuthorId(row.id); setSearch(''); }}>{row.name}</Button></td>
          <td className="px-5 py-2 tabular-nums"><div className="flex items-center gap-3">{row.clientCount}<span aria-hidden="true" className="hidden h-1.5 w-20 overflow-hidden rounded-full bg-muted md:block"><span className="block h-full rounded-full bg-primary/70" style={{ width: `${100 * row.clientCount / totals.people[0].clientCount}%` }} /></span></div></td>
          <td className="px-5 py-2 tabular-nums">{row.feedbackCount}</td>
        </tr>)}</tbody>
      </table></div> : <p className="px-5 pb-5 text-sm text-muted-foreground">No feedback was posted in this date range.</p>}
    </Card>}
    {person && <PersonClients key={`${range.from}:${range.to}:${person.id}`} userId={userId} range={range} person={person} search={search} onSearch={setSearch} />}
  </div>;
}
