"use client";

import { useId, useState } from "react";
import { Input } from "@/components/ui/input";
import { getSupportTechnologyError, SUPPORT_TECHNOLOGIES } from "@/lib/utils/support-technology";

interface SupportTechnologyFieldProps {
  value: string;
  onChange: (value: string) => void;
}

export function SupportTechnologyField({ value, onChange }: SupportTechnologyFieldProps) {
  const id = useId();
  const [otherSelected, setOtherSelected] = useState(false);
  const isPreset = SUPPORT_TECHNOLOGIES.some((technology) => technology === value);
  const isOther = otherSelected || Boolean(value && !isPreset);
  const error = value ? getSupportTechnologyError(value) : null;

  return (
    <div className="space-y-2 min-w-0">
      <select
        aria-label="Technology"
        aria-required="true"
        required
        value={isOther ? "Other" : value}
        onChange={(event) => {
          const nextValue = event.target.value;
          setOtherSelected(nextValue === "Other");
          onChange(nextValue === "Other" ? "" : nextValue);
        }}
        className="flex h-8 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <option value="" disabled>Select technology</option>
        {SUPPORT_TECHNOLOGIES.map((technology) => (
          <option key={technology} value={technology}>{technology}</option>
        ))}
        <option value="Other">Other</option>
      </select>
      {isOther && (
        <>
          <Input
            aria-label="Other technologies"
            aria-describedby={`${id}-help${error ? ` ${id}-error` : ""}`}
            aria-invalid={Boolean(error)}
            required
            value={value}
            onChange={(event) => onChange(event.target.value)}
            placeholder="e.g. Java, Python, React"
            className="h-8"
          />
          <p id={`${id}-help`} className="text-xs text-muted-foreground">
            Enter up to 3 technologies, separated by commas.
          </p>
          {error && <p id={`${id}-error`} role="alert" className="text-xs text-destructive">{error}</p>}
        </>
      )}
    </div>
  );
}
