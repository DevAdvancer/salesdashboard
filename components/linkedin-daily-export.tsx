'use client';

import { useState } from 'react';
import { Download } from 'lucide-react';
import { exportMyLinkedinSentDataAction } from '@/app/actions/linkedin/export';
import { Button } from '@/components/ui/button';
import { DatePicker } from '@/components/ui/date-picker';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import { getCurrentEasternIsoDate } from '@/lib/utils/eastern-date';

export function LinkedinDailyExport() {
  const [date, setDate] = useState(getCurrentEasternIsoDate);
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();

  async function download() {
    setBusy(true);
    try {
      const rows = await exportMyLinkedinSentDataAction(date);
      if (!rows.length) {
        toast({ title: 'No requests to export', description: 'No requests sent by you from your own accounts on this day.' });
        return;
      }
      const XLSX = await import('xlsx');
      const sheet = XLSX.utils.json_to_sheet(rows);
      sheet['!cols'] = [12, 28, 12, 25, 65, 14].map(wch => ({ wch }));
      const book = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(book, sheet, 'Sent requests');
      XLSX.writeFile(book, `linkedin-sent-${date}.xlsx`, { bookType: 'xlsx' });
    } catch (error) {
      toast({ title: 'Could not export requests', description: error instanceof Error ? error.message : 'Please try again.', variant: 'destructive' });
    } finally { setBusy(false); }
  }

  return <div className="flex flex-wrap items-end gap-3 rounded-lg border p-4">
    <div className="space-y-2">
      <Label htmlFor="linkedin-export-date">Export my sent requests</Label>
      <DatePicker id="linkedin-export-date" value={date} onChange={setDate} disabled={busy} />
    </div>
    <Button variant="outline" disabled={busy || !date} onClick={() => void download()}>
      <Download className="mr-2 h-4 w-4" />{busy ? 'Exporting…' : 'Download Excel'}
    </Button>
    <p className="w-full text-xs text-muted-foreground">Requests sent by you from your own LinkedIn accounts on the selected day (Eastern time), including their current status.</p>
  </div>;
}
