'use client';

import { useRef } from 'react';
import { Input } from '@/components/ui/input';

export function OtpCodeInput({ id, value, onChange, disabled }: {
  id: string; value: string; onChange: (value: string) => void; disabled?: boolean;
}) {
  const inputs = useRef<Array<HTMLInputElement | null>>([]);
  function enter(index: number, text: string) {
    const digits = text.replace(/\D/g, '').slice(0, 6);
    const start = digits.length === 6 ? 0 : index;
    const next = value.padEnd(6, ' ').split('');
    if (!digits) next[index] = ' ';
    else [...digits].forEach((digit, offset) => { if (start + offset < 6) next[start + offset] = digit; });
    onChange(next.join('').trimEnd());
    if (digits) inputs.current[Math.min(start + digits.length, 5)]?.focus();
  }
  return <div className="grid grid-cols-6 gap-2" role="group" aria-label="Six-digit email verification code">
    {Array.from({ length: 6 }, (_, index) => <Input key={index}
      ref={element => { inputs.current[index] = element; }}
      id={index === 0 ? id : `${id}-${index + 1}`} aria-label={index === 0 ? 'Email verification code' : `Digit ${index + 1} of 6`}
      className="h-12 min-w-0 rounded-lg border border-border px-0 text-center text-xl font-semibold tabular-nums"
      type="text" inputMode="numeric" autoComplete={index === 0 ? 'one-time-code' : 'off'}
      maxLength={6} pattern="[0-9]" required disabled={disabled} value={value[index]?.trim() || ''}
      onFocus={event => event.target.select()}
      onChange={event => enter(index, event.target.value)}
      onPaste={event => { event.preventDefault(); enter(index, event.clipboardData.getData('text')); }}
      onKeyDown={event => {
        if (event.key === 'Backspace') {
          event.preventDefault();
          const target = value[index]?.trim() ? index : Math.max(0, index - 1);
          enter(target, ''); inputs.current[target]?.focus();
        } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
          event.preventDefault(); inputs.current[Math.max(0, Math.min(5, index + (event.key === 'ArrowLeft' ? -1 : 1)))]?.focus();
        }
      }} />)}
  </div>;
}
