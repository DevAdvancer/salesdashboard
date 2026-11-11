'use client';

import Link from 'next/link';
import { Suspense, useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'next/navigation';
import { endOfMonth, endOfWeek, format, parseISO, startOfMonth, startOfWeek } from 'date-fns';
import { Download, ExternalLink } from 'lucide-react';
import { addLinkedinConversationMessageAction, exportLinkedinConversationsAction, getLinkedinConversationAction, listLinkedinConversationsAction } from '@/app/actions/linkedin/conversations';
import { ProtectedRoute } from '@/components/protected-route';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useLinkedinConversationAccess } from '@/lib/hooks/use-linkedin-conversation-access';
import { useAuth } from '@/lib/contexts/auth-context';
import { formatEasternDateTime, getCurrentEasternIsoDate } from '@/lib/utils/eastern-date';
import { getLinkedinRequestDateFilterValue } from '@/lib/utils/linkedin-request-dates';
import { normalizeProfileUrl } from '@/lib/utils/linkedin-extension-url';
import { getErrorMessage } from '@/lib/utils';
import { LINKEDIN_MESSAGE_TEXT_LIMIT, type LinkedinConversation, type LinkedinConversationMode } from '@/lib/types/linkedin-conversation';

type RangePreset = 'Day' | 'Week' | 'Month' | 'Custom range';
type Transcript = Awaited<ReturnType<typeof getLinkedinConversationAction>>;
type ExportRows = Awaited<ReturnType<typeof exportLinkedinConversationsAction>>;
const presets: RangePreset[] = ['Day', 'Week', 'Month', 'Custom range'];
const selectStyle = 'h-9 rounded-md border bg-background px-3 text-sm';

function presetRange(preset: Exclude<RangePreset, 'Custom range'>) {
  const today = getCurrentEasternIsoDate();
  const date = parseISO(today);
  if (preset === 'Day') return { start: today, end: today };
  const week = { weekStartsOn: 1 } as const;
  return { start: format(preset === 'Week' ? startOfWeek(date, week) : startOfMonth(date), 'yyyy-MM-dd'),
    end: format(preset === 'Week' ? endOfWeek(date, week) : endOfMonth(date), 'yyyy-MM-dd') };
}

async function downloadWorkbook(rows: ExportRows, filename: string) {
  const XLSX = await import('xlsx');
  const requests = XLSX.utils.json_to_sheet(rows.map(row => ({
    'Conversation ID': row.id, 'Request ID': row.requestId, Agent: row.agent, Account: row.account, Company: row.company,
    'Profile URL': row.targetUrl, 'Sent date (ET)': getLinkedinRequestDateFilterValue(row.dateSent),
    'Accepted at (ET)': row.acceptedAt ? formatEasternDateTime(row.acceptedAt) : '',
    'Withdrawn at (ET)': row.withdrawnAt ? formatEasternDateTime(row.withdrawnAt) : '',
    Status: row.status, 'Initial invitation text': row.initialText,
  })));
  const messages = XLSX.utils.json_to_sheet(rows.flatMap(row => row.messages.map(message => ({
    'Conversation ID': row.id, 'Request ID': row.requestId, 'Profile URL': row.targetUrl,
    'Message date (ET)': message.date, Direction: message.direction, Message: message.text,
  }))), { header: ['Conversation ID', 'Request ID', 'Profile URL', 'Message date (ET)', 'Direction', 'Message'] });
  requests['!cols'] = [38, 38, 22, 22, 25, 55, 18, 23, 23, 14, 65].map(wch => ({ wch }));
  messages['!cols'] = [38, 38, 55, 20, 13, 75].map(wch => ({ wch }));
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, requests, 'Requests');
  XLSX.utils.book_append_sheet(book, messages, 'Messages');
  XLSX.writeFile(book, filename, { bookType: 'xlsx' });
}

function ConversationDetail({ item }: { item: LinkedinConversation }) {
  const [transcript, setTranscript] = useState<Transcript | null>(null);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [direction, setDirection] = useState<'sent' | 'received'>('sent');
  const [date, setDate] = useState(getCurrentEasternIsoDate);
  const [text, setText] = useState('');
  const [messageId, setMessageId] = useState<string>();
  const [saving, setSaving] = useState(false);
  const { id, requestId } = item;

  useEffect(() => {
    let cancelled = false;
    void getLinkedinConversationAction({ requestId, conversationId: id }).then(data => {
      if (!cancelled) setTranscript(data);
    }).catch(error => {
      if (!cancelled) { setTranscript(null); setError(getErrorMessage(error)); }
    });
    return () => { cancelled = true; };
  }, [requestId, id, refresh]);

  async function save(event: FormEvent) {
    event.preventDefault();
    const newId = messageId ?? crypto.randomUUID();
    setMessageId(newId);
    setError('');
    setSaving(true);
    try {
      await addLinkedinConversationMessageAction({ requestId, conversationId: id, id: newId, direction, date, text });
      setText('');
      setMessageId(undefined);
      setRefresh(value => value + 1);
    } catch (error) { setError(getErrorMessage(error)); }
    finally { setSaving(false); }
  }

  let profileUrl: string | undefined;
  try { profileUrl = normalizeProfileUrl(item.targetUrl); } catch { /* Legacy profile text can still be displayed. */ }

  return <Card>
    <CardHeader>
      <CardTitle className="flex flex-wrap items-center gap-2">{item.company} <Badge variant="outline" className="capitalize">{item.status}</Badge></CardTitle>
      {profileUrl ? <a className="inline-flex items-center gap-1 break-all text-sm underline" href={profileUrl} target="_blank" rel="noreferrer">
        {item.targetUrl} <ExternalLink className="size-3 shrink-0" />
      </a> : <p className="break-all text-sm">{item.targetUrl}</p>}
    </CardHeader>
    <CardContent className="space-y-4 text-sm">
      {error && <p role="alert" className="text-destructive">{error}</p>}
      {!transcript && !error && <p>Loading conversation…</p>}
      {transcript && <>
        <section className="space-y-2 rounded-md border bg-muted/30 p-3">
          <h2 className="font-medium">Initial invitation text</h2>
          <p className="whitespace-pre-wrap break-words">{transcript.initialText || 'No invitation text was recorded.'}</p>
        </section>
        <section className="space-y-2">
          <h2 className="font-medium">Follow-up messages</h2>
          {transcript.messages.length === 0 && <p className="text-muted-foreground">No follow-up messages yet.</p>}
          {transcript.messages.map(message => <article key={message.id} className="space-y-1 rounded-md border p-3">
            <p className="text-xs text-muted-foreground">{message.direction === 'sent' ? 'Sent' : 'Received'} · {message.date} ET</p>
            <p className="whitespace-pre-wrap break-words">{message.text}</p>
          </article>)}
        </section>
        {transcript.conversation.canAppend && <form onSubmit={event => void save(event)} className="space-y-3 border-t pt-4">
          <div className="flex flex-wrap gap-3">
            <div className="space-y-1"><Label htmlFor="message-direction">Direction</Label>
              <select id="message-direction" className={selectStyle} value={direction} disabled={saving}
                onChange={event => { setDirection(event.target.value as typeof direction); setMessageId(undefined); }}>
                <option value="sent">Sent</option><option value="received">Received</option>
              </select></div>
            <div className="space-y-1"><Label htmlFor="message-date">Message date (ET)</Label>
              <Input id="message-date" type="date" value={date} min={getLinkedinRequestDateFilterValue(item.dateSent)} max={getCurrentEasternIsoDate()}
                onChange={event => { setDate(event.target.value); setMessageId(undefined); }} disabled={saving} required /></div>
          </div>
          <div className="space-y-1"><Label htmlFor="message-text">Message</Label>
            <Textarea id="message-text" value={text} onChange={event => { setText(event.target.value); setMessageId(undefined); }}
              maxLength={LINKEDIN_MESSAGE_TEXT_LIMIT} disabled={saving} required /></div>
          <Button type="submit" disabled={saving || !text.trim() || !date}>{saving ? 'Saving…' : 'Add message'}</Button>
        </form>}
      </>}
    </CardContent>
  </Card>;
}

function LinkedinConversationsContent() {
  const params = useSearchParams();
  const { user } = useAuth();
  const requestId = params.get('request');
  const date = params.get('date');
  const focusedDate = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
  const [mode, setMode] = useState<LinkedinConversationMode>(params.get('view') === 'sent' ? 'sent' : 'accepted');
  const [preset, setPreset] = useState<RangePreset>(focusedDate ? 'Custom range' : 'Month');
  const [{ start, end }, setRange] = useState(() => focusedDate ? { start: focusedDate, end: focusedDate } : presetRange('Month'));
  const [search, setSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [rows, setRows] = useState<LinkedinConversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let cancelled = false;
    setError('');
    setNotice('');
    setLoading(true);
    setRows([]);
    setSelected(new Set());
    setActiveId(null);
    if (!start || !end || start > end) {
      setError('Choose a valid start and end date.');
      setLoading(false);
      return;
    }
    void listLinkedinConversationsAction({ mode, start, end, search: appliedSearch }).then(data => {
      if (cancelled) return;
      setRows(data);
      setActiveId(data.find(row => row.requestId === requestId)?.id ?? null);
    }).catch(error => { if (!cancelled) setError(getErrorMessage(error)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [mode, start, end, appliedSearch, requestId]);

  async function download() {
    setExporting(true);
    setError('');
    setNotice('');
    try {
      const data = await exportLinkedinConversationsAction({ mode, start, end, search: appliedSearch }, selected.size ? [...selected] : undefined);
      if (!data.length) { setNotice('No matching requests to export.'); return; }
      await downloadWorkbook(data, `linkedin-${mode}-${start}-to-${end}.xlsx`);
    } catch (error) { setError(getErrorMessage(error)); }
    finally { setExporting(false); }
  }

  const active = rows.find(row => row.id === activeId);
  return <div className="container mx-auto max-w-7xl space-y-5">
    <header className="flex flex-wrap items-center gap-3">
      <h1 className="text-3xl font-semibold">Accepted Connections</h1><Badge variant="secondary">Beta</Badge>
      <Link className="ml-auto text-sm underline" href={user?.role === 'admin' ? '/linkedin-reports' : '/linkedin-requests'}>
        {user?.role === 'admin' ? 'LinkedIn Reports' : 'LinkedIn Requests'}
      </Link>
    </header>
    <div className="flex gap-2" aria-label="Request view">
      <Button variant={mode === 'accepted' ? 'default' : 'outline'} onClick={() => setMode('accepted')} aria-pressed={mode === 'accepted'}>Accepted connections</Button>
      <Button variant={mode === 'sent' ? 'default' : 'outline'} onClick={() => setMode('sent')} aria-pressed={mode === 'sent'}>Sent requests</Button>
    </div>
    <Card>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-2"><Label htmlFor="conversation-range">Date range</Label>
            <select id="conversation-range" value={preset} className={selectStyle} onChange={event => {
              const value = event.target.value as RangePreset;
              setPreset(value);
              if (value !== 'Custom range') setRange(presetRange(value));
            }}>{presets.map(value => <option key={value}>{value}</option>)}</select></div>
          <div className="space-y-2"><Label htmlFor="conversation-start">Start date (ET)</Label>
            <Input id="conversation-start" type="date" value={start} onChange={event => { setPreset('Custom range'); setRange({ start: event.target.value, end }); }} /></div>
          <div className="space-y-2"><Label htmlFor="conversation-end">End date (ET)</Label>
            <Input id="conversation-end" type="date" value={end} onChange={event => { setPreset('Custom range'); setRange({ start, end: event.target.value }); }} /></div>
          <Button variant="outline" disabled={loading || exporting || !rows.length} onClick={() => void download()}>
            <Download className="size-4" />{exporting ? 'Exporting…' : selected.size ? `Export selected (${selected.size})` : 'Export Excel'}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">Filtered by {mode === 'sent' ? 'invitation sent date' : 'acceptance date'}. Exports include the full saved conversation.</p>
        <form className="flex max-w-lg gap-2" onSubmit={event => { event.preventDefault(); setAppliedSearch(search.trim()); }}>
          <Input aria-label="Company or profile URL" placeholder="Company or profile URL" value={search} maxLength={300} onChange={event => setSearch(event.target.value)} />
          <Button type="submit" variant="outline">Search</Button>
        </form>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {notice && <p role="status" className="text-sm">{notice}</p>}
      </CardContent>
    </Card>
    <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <Card>
        <CardHeader><CardTitle>{mode === 'accepted' ? 'Connections' : 'Invitations'}</CardTitle></CardHeader>
        <CardContent>
          {loading ? <p role="status" className="text-sm">Loading requests…</p> : !rows.length && !error ? <p className="text-sm text-muted-foreground">No matching requests.</p> :
            <ul className="divide-y">{rows.map(row => <li key={row.id} className="flex items-start gap-3 py-2">
              <input type="checkbox" className="mt-2 size-4" aria-label={`Select ${row.company} ${row.targetUrl} for export`} checked={selected.has(row.id)}
                onChange={event => {
                  const next = new Set(selected);
                  if (event.target.checked) next.add(row.id); else next.delete(row.id);
                  setSelected(next);
                }} />
              <button className="min-w-0 flex-1 rounded-md p-1 text-left hover:bg-accent aria-pressed:bg-accent" aria-pressed={row.id === activeId} onClick={() => setActiveId(row.id)}>
                <span className="flex flex-wrap items-center gap-2 text-sm font-medium">{row.company}<Badge variant="outline" className="capitalize">{row.status}</Badge></span>
                <span className="block break-all text-xs text-muted-foreground">{row.targetUrl}</span>
                <span className="block text-xs text-muted-foreground">{mode === 'accepted' && row.acceptedAt
                  ? `Accepted ${getCurrentEasternIsoDate(new Date(row.acceptedAt))}` : `Sent ${getLinkedinRequestDateFilterValue(row.dateSent)}`} ET</span>
              </button>
            </li>)}</ul>}
        </CardContent>
      </Card>
      {active && <ConversationDetail key={active.id} item={active} />}
    </div>
  </div>;
}

function LinkedinConversationGate() {
  const enabled = useLinkedinConversationAccess();
  if (enabled === null) return <p role="status">Checking beta access…</p>;
  if (!enabled) return <div className="space-y-3"><h1 className="text-2xl font-semibold">Beta access required</h1>
    <Link href="/dashboard" className="text-sm underline">Back to dashboard</Link></div>;
  return <Suspense fallback={<p role="status">Loading connections…</p>}><LinkedinConversationsContent /></Suspense>;
}

export default function LinkedinConversationsPage() {
  return <ProtectedRoute componentKey="linkedin-conversations"><LinkedinConversationGate /></ProtectedRoute>;
}
