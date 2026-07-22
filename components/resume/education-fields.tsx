'use client';

import { Plus, Trash2, GraduationCap, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  emptyEducationEntry,
  type EducationEntry,
} from '@/lib/utils/resume-fields';

interface EducationFieldsProps {
  entries: EducationEntry[];
  onChange: (entries: EducationEntry[]) => void;
  legacyText?: string;
}

const DEGREE_OPTIONS = [
  'Bachelors',
  'Masters',
  'PhD',
  'Bootcamp',
  'Diploma',
  'Certificate',
  'Other',
];

export function EducationFields({ entries, onChange, legacyText }: EducationFieldsProps) {
  const rows = entries.length > 0 ? entries : [emptyEducationEntry()];

  const updateRow = (index: number, patch: Partial<EducationEntry>) => {
    const next = rows.map((row, i) => (i === index ? { ...row, ...patch } : row));
    onChange(next);
  };

  const addRow = () => {
    onChange([...rows, emptyEducationEntry()]);
  };

  const removeRow = (index: number) => {
    const next = rows.filter((_, i) => i !== index);
    onChange(next.length > 0 ? next : [emptyEducationEntry()]);
  };

  const inputClass =
    'w-full rounded-md border border-input bg-background px-2.5 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-primary';

  return (
    <div className="space-y-3">
      {legacyText && (
        <div className="flex items-start gap-2 rounded-md border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 p-2.5 text-[11px] text-amber-800 dark:text-amber-300">
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <div>
            <span className="font-semibold">Previously entered:</span>{' '}
            {legacyText}
            <div className="mt-0.5 opacity-80">
              Please re-enter this information using the structured fields below.
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
                <GraduationCap className="h-3.5 w-3.5" />
                Education {index + 1}
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
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="block text-[11px] font-medium text-muted-foreground mb-1">
                    Degree Type
                  </label>
                  <select
                    value={row.type}
                    onChange={(e) => updateRow(index, { type: e.target.value })}
                    className={inputClass}
                  >
                    <option value="">-- Select --</option>
                    {DEGREE_OPTIONS.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                </div>
                {row.type === 'Other' && (
                  <div className="flex-1">
                    <label className="block text-[11px] font-medium text-muted-foreground mb-1">
                      Specify Other
                    </label>
                    <input
                      type="text"
                      value={row.otherType}
                      onChange={(e) => updateRow(index, { otherType: e.target.value })}
                      placeholder="e.g. Associate"
                      className={inputClass}
                    />
                  </div>
                )}
              </div>
              <div>
                <label className="block text-[11px] font-medium text-muted-foreground mb-1">
                  College / University Name
                </label>
                <input
                  type="text"
                  value={row.institution}
                  onChange={(e) => updateRow(index, { institution: e.target.value })}
                  placeholder="e.g. Texas A&M"
                  className={inputClass}
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-muted-foreground mb-1">
                  Start Date (MM/YYYY)
                </label>
                <input
                  type="text"
                  value={row.startDate}
                  onChange={(e) => updateRow(index, { startDate: e.target.value })}
                  placeholder="MM/YYYY"
                  className={inputClass}
                />
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-[11px] font-medium text-muted-foreground">
                    End Date
                  </label>
                  <label className="flex items-center gap-1.5 text-[10px] font-medium cursor-pointer">
                    <input
                      type="checkbox"
                      checked={row.isPresent}
                      onChange={(e) =>
                        updateRow(index, { isPresent: e.target.checked, endDate: '' })
                      }
                      className="rounded border-input text-primary focus:ring-primary"
                    />
                    Present
                  </label>
                </div>
                <input
                  type="text"
                  value={row.isPresent ? 'Present' : row.endDate}
                  disabled={row.isPresent}
                  onChange={(e) => updateRow(index, { endDate: e.target.value })}
                  placeholder={row.isPresent ? 'Present' : 'MM/YYYY'}
                  className={`${inputClass} ${
                    row.isPresent ? 'bg-muted text-muted-foreground' : ''
                  }`}
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
        Add Education
      </Button>
    </div>
  );
}
