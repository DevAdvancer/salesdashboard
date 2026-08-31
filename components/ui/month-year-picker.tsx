'use client';

import * as React from 'react';

interface MonthYearPickerProps {
  value: string; // format: "YYYY-MM" or empty string
  onChange: (value: string) => void;
  className?: string;
  disabled?: boolean;
}

const MONTHS = [
  { value: '01', label: 'Jan' },
  { value: '02', label: 'Feb' },
  { value: '03', label: 'Mar' },
  { value: '04', label: 'Apr' },
  { value: '05', label: 'May' },
  { value: '06', label: 'Jun' },
  { value: '07', label: 'Jul' },
  { value: '08', label: 'Aug' },
  { value: '09', label: 'Sep' },
  { value: '10', label: 'Oct' },
  { value: '11', label: 'Nov' },
  { value: '12', label: 'Dec' },
];

export function MonthYearPicker({ value, onChange, className, disabled }: MonthYearPickerProps) {
  const currentYear = new Date().getFullYear();
  const years = React.useMemo(() => {
    const arr = [];
    for (let i = currentYear + 5; i >= 1970; i--) {
      arr.push(i.toString());
    }
    return arr;
  }, [currentYear]);

  const [year, month] = value ? value.split('-') : ['', ''];

  const handleMonthChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newMonth = e.target.value;
    if (!newMonth && !year) {
      onChange('');
    } else if (newMonth && year) {
      onChange(`${year}-${newMonth}`);
    } else if (newMonth) {
      // default year to current if month selected but no year
      onChange(`${currentYear}-${newMonth}`);
    }
  };

  const handleYearChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newYear = e.target.value;
    if (!newYear && !month) {
      onChange('');
    } else if (newYear && month) {
      onChange(`${newYear}-${month}`);
    } else if (newYear) {
      // default month to Jan if year selected but no month
      onChange(`${newYear}-01`);
    }
  };

  return (
    <div className={`flex gap-1.5 ${className || ''}`}>
      <select
        value={month}
        onChange={handleMonthChange}
        disabled={disabled}
        className="w-full flex-1 rounded-md border border-input bg-background px-2 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <option value="">Month</option>
        {MONTHS.map((m) => (
          <option key={m.value} value={m.value}>
            {m.label}
          </option>
        ))}
      </select>
      <select
        value={year}
        onChange={handleYearChange}
        disabled={disabled}
        className="w-full flex-1 rounded-md border border-input bg-background px-2 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <option value="">Year</option>
        {years.map((y) => (
          <option key={y} value={y}>
            {y}
          </option>
        ))}
      </select>
    </div>
  );
}
