'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { listLinkedinHelperBetaUsersAction, setLinkedinHelperBetaAccessAction } from '@/app/actions/beta';
import { useAuth } from '@/lib/contexts/auth-context';
import { queryKeys } from '@/lib/queries/keys';
import { LINKEDIN_HELPER_BETA_VERSION, LINKEDIN_HELPER_STABLE_VERSION } from '@/lib/constants/linkedin-helper-release';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';

export function LinkedinBetaManagement() {
  const { user, serverSessionReady } = useAuth();
  const client = useQueryClient();
  const [search, setSearch] = useState('');
  const key = queryKeys.linkedinHelper.betaUsers(user?.$id ?? '');
  const users = useQuery({ queryKey: key, queryFn: () => listLinkedinHelperBetaUsersAction(),
    staleTime: 0, refetchOnMount: 'always', refetchOnWindowFocus: 'always', refetchInterval: 60_000,
    enabled: serverSessionReady && user?.role === 'admin' && user.isActive !== false });
  const mutation = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => setLinkedinHelperBetaAccessAction(id, enabled),
    onSuccess: async () => {
      await Promise.all([client.invalidateQueries({ queryKey: key }), client.invalidateQueries({ queryKey: ['linkedin-helper', 'access'] })]);
    },
  });
  const filtered = users.data?.filter(item => `${item.name} ${item.email}`.toLowerCase().includes(search.toLowerCase()));
  return <Card>
    <CardHeader>
      <CardTitle>LinkedIn Helper beta</CardTitle>
      <CardDescription>Selected users get v{LINKEDIN_HELPER_BETA_VERSION} and its update notice. Everyone else keeps v{LINKEDIN_HELPER_STABLE_VERSION}. Changes save individually.</CardDescription>
    </CardHeader>
    <CardContent className="space-y-4">
      <Input aria-label="Search beta users" placeholder="Search by name or email" value={search} onChange={event => setSearch(event.target.value)} />
      {users.isPending && <p role="status">Loading users…</p>}
      {users.isError && <div role="alert">Unable to load beta access. <Button variant="outline" onClick={() => users.refetch()}>Retry</Button></div>}
      {mutation.isError && <p role="alert" className="text-sm text-destructive">Unable to save access. {mutation.error.message}</p>}
      {users.data && <p className="text-sm text-muted-foreground">{users.data.filter(item => item.enabled).length} selected</p>}
      <div className="divide-y">
        {filtered?.map(item => <div key={item.id} className="flex items-center justify-between gap-4 py-3">
          <div className="min-w-0 text-sm">
            <p className="font-medium">{item.name}</p>
            <p className="break-all text-muted-foreground">{item.email} · {item.role.replaceAll('_', ' ')}</p>
            {!item.eligible && <p className="text-muted-foreground">No longer eligible; beta access can be removed.</p>}
          </div>
          <Switch aria-label={`Beta access for ${item.name}`} checked={item.enabled}
            disabled={mutation.isPending || (!item.eligible && !item.enabled)}
            onCheckedChange={enabled => mutation.mutate({ id: item.id, enabled })} />
        </div>)}
      </div>
      {filtered?.length === 0 && <p className="text-sm text-muted-foreground">No matching eligible users.</p>}
    </CardContent>
  </Card>;
}
