'use client';

import { useEffect, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

type Options = { title: string; description?: string; label: string; confirmText?: string; maxLength?: number };
export function usePromptDialog() {
  const [options, setOptions] = useState<Options | null>(null);
  const [value, setValue] = useState('');
  const resolver = useRef<((value: string | null) => void) | null>(null);
  useEffect(() => () => resolver.current?.(null), []);
  function close(result: string | null) { resolver.current?.(result); resolver.current = null; setOptions(null); }
  const prompt = (next: Options) => {
    resolver.current?.(null); setValue(''); setOptions(next);
    return new Promise<string | null>(resolve => { resolver.current = resolve; });
  };
  const promptDialog = <Dialog open={Boolean(options)} onOpenChange={open => { if (!open) close(null); }}>
    <DialogContent><DialogHeader><DialogTitle>{options?.title}</DialogTitle>
      {options?.description && <DialogDescription>{options.description}</DialogDescription>}
    </DialogHeader><form className="space-y-4" onSubmit={event => { event.preventDefault(); if (value.trim()) close(value.trim()); }}>
      <div className="space-y-2"><Label htmlFor="crm-prompt-value">{options?.label}</Label>
        <Textarea id="crm-prompt-value" value={value} onChange={event => setValue(event.target.value)} required maxLength={options?.maxLength || 1000} autoFocus />
      </div><DialogFooter><Button type="button" variant="outline" onClick={() => close(null)}>Cancel</Button>
        <Button type="submit" disabled={!value.trim()}>{options?.confirmText || 'Confirm'}</Button>
      </DialogFooter>
    </form></DialogContent>
  </Dialog>;
  return { prompt, promptDialog };
}
