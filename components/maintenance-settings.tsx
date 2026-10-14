'use client';

import { useEffect, useState } from 'react';
import { getMaintenanceSettingsAction, setMaintenanceModeAction } from '@/app/actions/maintenance';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';

type Status = { active: boolean; enabled: boolean; endsAt: string | null };

function easternInputValue(value: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(value));
  const get = (type: string) => parts.find(part => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}

export function MaintenanceSettings() {
  const { toast } = useToast();
  const [status, setStatus] = useState<Status | null>(null);
  const [endsAtEastern, setEndsAtEastern] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let mounted = true;
    getMaintenanceSettingsAction().then(result => {
      if (!mounted) return;
      setStatus(result);
      if (result.endsAt) setEndsAtEastern(easternInputValue(result.endsAt));
    }).catch(error => {
      if (mounted) toast({ title: 'Unable to load maintenance settings',
        description: error instanceof Error ? error.message : undefined, variant: 'destructive' });
    });
    return () => { mounted = false; };
  }, [toast]);

  const update = async (enabled: boolean) => {
    setSaving(true);
    try {
      const result = await setMaintenanceModeAction({ enabled, endsAtEastern });
      setStatus(result);
      toast({ title: enabled ? 'Maintenance mode is on' : 'Maintenance mode is off',
        description: enabled ? `${result.signedOut} users signed out.${result.failedUserIds.length ? ` ${result.failedUserIds.length} session revocations failed; the server access guard remains active.` : ''}` : undefined,
        variant: result.failedUserIds.length ? 'destructive' : undefined });
    } catch (error) {
      toast({ title: 'Unable to update maintenance mode',
        description: error instanceof Error ? error.message : undefined, variant: 'destructive' });
    } finally { setSaving(false); }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Maintenance mode</CardTitle>
        <CardDescription>When enabled, other users are signed out and see a maintenance page until the Eastern time you set. Your admin account keeps access.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm font-medium">Status: {status ? status.active ? 'On' : 'Off' : 'Loading…'}</p>
        <div className="max-w-sm space-y-2">
          <Label htmlFor="maintenance-end">End time (Eastern)</Label>
          <Input id="maintenance-end" type="datetime-local" value={endsAtEastern}
            onChange={event => setEndsAtEastern(event.target.value)} disabled={saving} />
        </div>
        <div className="flex gap-2">
          <Button onClick={() => update(true)} disabled={saving || !status || !endsAtEastern} loading={saving}>Turn on</Button>
          <Button variant="outline" onClick={() => update(false)} disabled={saving || !status || !status.enabled}>Turn off</Button>
        </div>
      </CardContent>
    </Card>
  );
}
