'use client';

import * as React from 'react';
import { DatePicker } from '@/components/ui/date-picker';

/** Preserve native date/form values while presenting the CRM calendar. */
export const CrmDateInput = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function CrmDateInput({
  id, value, defaultValue, onChange, onBlur, onInvalid, className, style, disabled, readOnly, min, max, required,
  'aria-label': ariaLabel, 'aria-labelledby': labelledBy, 'aria-describedby': describedBy, ...props
}, forwardedRef) {
  const native = React.useRef<HTMLInputElement | null>(null);
  const generatedId = React.useId();
  const controlId = id || generatedId;
  const [selected, setSelected] = React.useState(String(value ?? defaultValue ?? ''));
  const [invalid, setInvalid] = React.useState(false);
  React.useLayoutEffect(() => {
    const element = native.current;
    if (!element) return;
    const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!;
    Object.defineProperty(element, 'value', { configurable: true, get: () => descriptor.get!.call(element),
      set: next => { descriptor.set!.call(element, next); setSelected(element.value); } });
    const focus = element.focus;
    element.focus = () => document.getElementById(controlId)?.focus();
    setSelected(element.value);
    const reset = () => window.setTimeout(() => { setSelected(element.value); setInvalid(false); }, 0);
    element.form?.addEventListener('reset', reset);
    return () => { element.form?.removeEventListener('reset', reset); delete (element as unknown as Record<string, unknown>).value; element.focus = focus; };
  }, [controlId]);
  React.useLayoutEffect(() => { if (native.current) setSelected(native.current.value); }, [value]);
  return <div className="min-w-0" style={style}>
    <input {...props} id={`${controlId}-form-control`} ref={element => {
      native.current = element;
      if (typeof forwardedRef === 'function') forwardedRef(element); else if (forwardedRef) forwardedRef.current = element;
    }} type="date" hidden aria-hidden="true" tabIndex={-1} value={value} defaultValue={defaultValue}
      disabled={disabled} readOnly={readOnly} min={min} max={max} required={required}
      onChange={event => { setSelected(event.target.value); setInvalid(false); onChange?.(event); }} onBlur={onBlur}
      onInvalid={event => { event.preventDefault(); setInvalid(true); document.getElementById(controlId)?.focus(); onInvalid?.(event); }} />
    <DatePicker id={controlId} value={selected} disabled={disabled || readOnly} minDate={min === undefined ? undefined : String(min)} maxDate={max === undefined ? undefined : String(max)} className={className}
      buttonProps={{ 'aria-label': ariaLabel, 'aria-labelledby': labelledBy, 'aria-describedby': describedBy, 'aria-required': required,
        'aria-invalid': invalid || undefined, onBlur: () => native.current?.dispatchEvent(new FocusEvent('focusout', { bubbles: true })) }}
      onChange={next => {
        if (!native.current) return;
        // Use the platform setter so React receives the actual change event,
        // rather than swallowing an event after its input tracker was updated.
        const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!;
        descriptor.set!.call(native.current, next);
        native.current.dispatchEvent(new Event('input', { bubbles: true }));
        native.current.dispatchEvent(new Event('change', { bubbles: true }));
        setSelected(next); setInvalid(false);
      }} />
    {invalid && <p role="alert" className="mt-1 text-xs text-destructive">Choose a date within the allowed range.</p>}
  </div>;
});
