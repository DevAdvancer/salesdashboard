'use client';

import { useEffect, useMemo, useState } from 'react';
import { listLinkedinHelperBetaUsersAction, setLinkedinHelperBetaAccessAction } from '@/app/actions/beta';
import { LinkedinExtensionGuide } from '@/components/linkedin-extension-guide';
import { ProtectedRoute } from '@/components/protected-route';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/lib/contexts/auth-context';

type BetaUser = Awaited<ReturnType<typeof listLinkedinHelperBetaUsersAction>>[number];

export default function BetaPage() {
  return <ProtectedRoute componentKey="beta"><BetaContent /></ProtectedRoute>;
}

function BetaContent() {
  const { user, serverSessionReady } = useAuth();
  const { toast } = useToast();
  const [users, setUsers] = useState<BetaUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [savingId, setSavingId] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (user?.role !== 'admin' || !serverSessionReady) return;
    let active = true;
    listLinkedinHelperBetaUsersAction().then(result => {
      if (active) { setUsers(result); setError(''); }
    }).catch(reason => {
      if (active) setError(reason instanceof Error ? reason.message : 'Could not load beta access.');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [user?.role, serverSessionReady]);

  const filtered = useMemo(() => users.filter(entry =>
    `${entry.name} ${entry.email} ${entry.role}`.toLowerCase().includes(search.trim().toLowerCase())), [users, search]);

  async function toggle(entry: BetaUser) {
    setSavingId(entry.id);
    try {
      const result = await setLinkedinHelperBetaAccessAction(entry.id, !entry.enabled);
      setUsers(previous => previous.map(item => item.id === result.userId ? { ...item, enabled: result.enabled } : item));
      toast({ title: result.enabled ? 'Extension access enabled' : 'Extension access removed', description: entry.name });
    } catch (reason) {
      toast({ title: 'Could not update access', description: reason instanceof Error ? reason.message : undefined, variant: 'destructive' });
    } finally { setSavingId(null); }
  }

  return <div className="container mx-auto max-w-5xl space-y-6">
    <div><h1 className="text-3xl font-semibold tracking-tight">Beta</h1>
      <p className="mt-2 text-sm text-muted-foreground">Choose who can use beta features. Access is enforced by the CRM server.</p></div>
    <Card>
      <CardHeader><CardTitle>LinkedIn Helper access</CardTitle>
        <CardDescription>Enabled users see the installation guide on LinkedIn Requests and can connect the extension.</CardDescription></CardHeader>
      <CardContent className="space-y-4">
        <Input aria-label="Search users" placeholder="Search name, email, or role" value={search} onChange={event => setSearch(event.target.value)} />
        {loading && <p className="text-sm text-muted-foreground">Loading users…</p>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {!loading && !error && filtered.length === 0 && <p className="text-sm text-muted-foreground">No eligible users found.</p>}
        <div className="divide-y rounded-lg border">
          {filtered.map(entry => <div key={entry.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
            <div><div className="font-medium">{entry.name}</div>
              <div className="text-xs text-muted-foreground">{entry.email} · {entry.role.replaceAll('_', ' ')}</div></div>
            <div className="flex items-center gap-2"><Badge variant={entry.enabled ? 'default' : 'secondary'}>
              {entry.enabled ? 'Enabled' : 'Off'}</Badge>
              <Button size="sm" variant={entry.enabled ? 'outline' : 'default'} disabled={savingId !== null}
                onClick={() => void toggle(entry)}>{savingId === entry.id ? 'Saving…' : entry.enabled ? 'Remove access' : 'Enable access'}</Button></div>
          </div>)}
        </div>
      </CardContent>
    </Card>
    <LinkedinExtensionGuide />
  </div>;
}
