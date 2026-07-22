'use client';

import { Plus, Trash2, Calendar, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  emptyTimelineEntry,
  type TimelineEntry,
} from '@/lib/utils/resume-fields';

interface TimelineFieldsProps {
  entries: TimelineEntry[];
  onChange: (entries: TimelineEntry[]) => void;
  legacyText?: string;
  hint?: string;
}

export function TimelineFields({
  entries,
  onChange,
  legacyText,
  hint,
}: TimelineFieldsProps) {
  const rows = entries.length > 0 ? entries : [emptyTimelineEntry()];

  const updateRow = (index: number, patch: Partial<TimelineEntry>) => {
    const next = rows.map((row, i) => (i === index ? { ...row, ...patch } : row));
    onChange(next);
  };

  const addRow = () => {
    onChange([...rows, emptyTimelineEntry()]);
  };

  const removeRow = (index: number) => {
    const next = rows.filter((_, i) => i !== index);
    onChange(next.length > 0 ? next : [emptyTimelineEntry()]);
  };

  const inputClass =
    'w-full rounded-md border border-input bg-background px-2.5 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-primary';

  return (
    <div className="space-y-3">
      {hint && (
        <p className="text-[11px] text-muted-foreground leading-relaxed">{hint}</p>
      )}

      {legacyText && (
        <div className="flex items-start gap-2 rounded-md border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 p-2.5 text-[11px] text-amber-800 dark:text-amber-300">
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <div>
            <span className="font-semibold">Previously entered (free text):</span>{' '}
            {legacyText}
            <div className="mt-0.5 opacity-80">
              Re-enter below as per-client rows; this note is kept for reference until you save.
            </div>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {rows.map((row, index) => (
          <div
            key={index}
            className="rounded-lg border border-border bg-muted/20 p-3 space-y-2.5"
          >
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
                <Calendar className="h-3.5 w-3.5" />
                Engagement {index + 1}
              </span>
              {rows.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeRow(index)}
                  className="inline-flex items-center gap-1 text-[11px] text-destructive hover:underline"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Remove
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <div>
                <label className="block text-[11px] font-medium text-muted-foreground mb-1">
                  Client (End-client or Vendor)
                </label>
                <input
                  type="text"
                  value={row.client}
                  onChange={(e) => updateRow(index, { client: e.target.value })}
                  placeholder="e.g. Apple (via TCS)"
                  className={inputClass}
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-muted-foreground mb-1">
                  Job Role
                </label>
                <input
                  type="text"
                  value={row.jobRole}
                  onChange={(e) => updateRow(index, { jobRole: e.target.value })}
                  placeholder="e.g. Frontend Engineer"
                  className={inputClass}
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-muted-foreground mb-1">
                  Start Date
                </label>
                <input
                  type="date"
                  value={row.startDate}
                  onChange={(e) => updateRow(index, { startDate: e.target.value })}
                  className={inputClass}
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-muted-foreground mb-1">
                  End Date
                </label>
                <input
                  type="date"
                  value={row.endDate}
                  onChange={(e) => updateRow(index, { endDate: e.target.value })}
                  className={inputClass}
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-[11px] font-medium text-muted-foreground mb-1">
                  Location
                </label>
                <input
                  type="text"
                  value={row.location}
                  onChange={(e) => updateRow(index, { location: e.target.value })}
                  placeholder="e.g. Austin, TX (Remote)"
                  className={inputClass}
                />
              </div>
            </div>
          </div>
        ))}
      </div>

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={addRow}
        className="gap-1.5 text-xs"
      >
        <Plus className="h-3.5 w-3.5" />
        Add Client Engagement
      </Button>
    </div>
  );
}
