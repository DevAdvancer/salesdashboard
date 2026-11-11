'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ProtectedRoute } from '@/components/protected-route';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/lib/contexts/auth-context';
import { listLinkedinConversationBetaUsersAction, setLinkedinConversationBetaAccessAction } from '@/app/actions/beta';
import { getErrorMessage } from '@/lib/utils';

type BetaUser = Awaited<ReturnType<typeof listLinkedinConversationBetaUsersAction>>[number];

function LinkedinConversationGrants() {
  const { serverSessionReady, user } = useAuth();
  const [users, setUsers] = useState<BetaUser[]>([]);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const reload = useCallback(async () => {
    setLoading(true);
    setError('');
    try { setUsers(await listLinkedinConversationBetaUsersAction()); }
    catch (error) { setError(getErrorMessage(error)); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { if (serverSessionReady) void reload(); }, [reload, serverSessionReady]);

  async function toggle(target: BetaUser) {
    setBusy(target.id);
    setError('');
    try {
      await setLinkedinConversationBetaAccessAction(target.id, !target.enabled);
      setUsers(previous => previous.map(item => item.id === target.id ? { ...item, enabled: !item.enabled } : item));
    } catch (error) { setError(getErrorMessage(error)); }
    finally { setBusy(''); }
  }

  return <Card>
    <CardHeader><CardTitle>LinkedIn Conversations</CardTitle></CardHeader>
    <CardContent className="space-y-4 text-sm">
      <p>Grant access to invitation text in LinkedIn Helper and the Accepted Connections page for individual Sales users.</p>
      {users.some(item => item.id === user?.$id && item.enabled && item.eligible) &&
        <Link className="inline-block underline" href="/linkedin-conversations">Open Accepted Connections</Link>}
      <Input aria-label="Find users" placeholder="Find users by name" value={search} onChange={event => setSearch(event.target.value)} />
      {error && <p role="alert" className="text-destructive">{error}</p>}
      {loading ? <p>Loading beta users…</p> : <ul className="divide-y rounded-md border px-3">
        {users.filter(item => item.name.toLowerCase().includes(search.trim().toLowerCase())).map(item =>
          <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
            <div><p className="font-medium">{item.name}</p><p className="capitalize text-muted-foreground">{item.role.replaceAll('_', ' ')}{item.eligible ? '' : ' · Ineligible'}</p></div>
            <Button size="sm" variant={item.enabled ? 'outline' : 'default'} disabled={Boolean(busy)}
              aria-label={`${item.enabled ? 'Revoke access for' : 'Grant access to'} ${item.name}`}
              onClick={() => void toggle(item)}>{busy === item.id ? 'Saving…' : item.enabled ? 'Revoke access' : 'Grant access'}</Button>
          </li>)}
      </ul>}
    </CardContent>
  </Card>;
}

export default function BetaPage() {
  return <ProtectedRoute componentKey="beta">
    <div className="container mx-auto max-w-5xl space-y-6">
      <h1 className="text-3xl font-semibold tracking-tight">Beta</h1>
      <LinkedinConversationGrants />
      <Card>
        <CardHeader><CardTitle>LinkedIn Helper is available to everyone</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p>All eligible LinkedIn Requests users can now use LinkedIn Helper. Individual beta access settings are no longer needed.</p>
          <Link className="underline" href="/linkedin-requests">Open LinkedIn Requests to download LinkedIn Helper</Link>
        </CardContent>
      </Card>
    </div>
  </ProtectedRoute>;
}
