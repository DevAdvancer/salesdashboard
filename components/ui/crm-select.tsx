'use client';

import * as React from 'react';
import { Select as SelectPrimitive } from 'radix-ui';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

type Props = Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'multiple' | 'size'>;
type Option = { value: string; label: React.ReactNode; disabled: boolean; group?: string };
function readOptions(children: React.ReactNode, group?: string, disabled = false): Option[] {
  return React.Children.toArray(children).flatMap(child => {
    if (!React.isValidElement(child)) return [];
    const props = child.props as React.OptionHTMLAttributes<HTMLOptionElement> & { label?: string };
    if (child.type === 'option') return [{ value: String(props.value ?? props.children ?? ''), label: props.children,
      disabled: disabled || Boolean(props.disabled), group }];
    return readOptions(props.children, child.type === 'optgroup' ? props.label : group, disabled || Boolean(props.disabled));
  });
}

/** Custom dropdown presentation with a hidden native form control so existing
 * FormData, React Hook Form, validation, reset and change handlers keep working. */
export const CrmSelect = React.forwardRef<HTMLSelectElement, Props>(function CrmSelect({
  children, className, style, id, onChange, onBlur, onInvalid, value, defaultValue,
  disabled, required, autoFocus, title, 'aria-label': ariaLabel, 'aria-labelledby': labelledBy,
  'aria-describedby': describedBy, 'aria-invalid': ariaInvalid, ...props
}, forwardedRef) {
  const native = React.useRef<HTMLSelectElement | null>(null);
  const trigger = React.useRef<HTMLButtonElement | null>(null);
  const generatedId = React.useId();
  const controlId = id || generatedId;
  const [selected, setSelected] = React.useState(String(value ?? defaultValue ?? ''));
  const [invalid, setInvalid] = React.useState(false);
  const options = readOptions(children);
  const label = options.find(option => option.value === selected)?.label;
  React.useLayoutEffect(() => {
    const element = native.current;
    if (!element) return;
    setSelected(element.value);
    const reset = () => window.setTimeout(() => { setSelected(element.value); setInvalid(false); }, 0);
    element.form?.addEventListener('reset', reset);
    return () => { element.form?.removeEventListener('reset', reset); };
  }, []);
  React.useLayoutEffect(() => { if (native.current) setSelected(native.current.value); }, [value, children]);

  return <div className="min-w-0">
    <select {...props} ref={element => {
      native.current = element;
      // Form libraries assign ref.value directly. Keep that supported without
      // replacing the native DOM value descriptor or losing its form behavior.
      const formRef = element && new Proxy(element, {
        get(target, key) {
          if (key === 'focus') return () => trigger.current?.focus();
          const result = Reflect.get(target, key, target);
          return typeof result === 'function' ? result.bind(target) : result;
        },
        set(target, key, next) {
          const result = Reflect.set(target, key, next, target);
          if (key === 'value') setSelected(target.value);
          return result;
        },
      });
      if (typeof forwardedRef === 'function') forwardedRef(formRef);
      else if (forwardedRef) forwardedRef.current = formRef;
    }} id={`${controlId}-form-control`} hidden aria-hidden="true" tabIndex={-1}
      value={value} defaultValue={defaultValue} disabled={disabled} required={required}
      onChange={event => { setSelected(event.currentTarget.value); setInvalid(false); onChange?.(event); }}
      onBlur={onBlur} onInvalid={event => { event.preventDefault(); setInvalid(true); trigger.current?.focus(); onInvalid?.(event); }}>
      {children}
    </select>
    <SelectPrimitive.Root value={`value:${selected}`} disabled={disabled} onValueChange={next => {
      if (!native.current) return;
      native.current.value = next.slice('value:'.length);
      native.current.dispatchEvent(new Event('change', { bubbles: true }));
    }}>
      <SelectPrimitive.Trigger ref={trigger} id={controlId} value={selected} autoFocus={autoFocus} title={title}
        aria-label={ariaLabel} aria-labelledby={labelledBy} aria-describedby={describedBy}
        aria-required={required} aria-invalid={ariaInvalid || invalid || undefined} style={style}
        onBlur={() => native.current?.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))}
        className={cn('flex h-10 w-full min-w-0 items-center justify-between gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50', className)}>
        <SelectPrimitive.Value><span className="truncate">{label || 'Select…'}</span></SelectPrimitive.Value>
        <SelectPrimitive.Icon><ChevronDown className="size-4 shrink-0" /></SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content position="popper" sideOffset={4} className="z-[100] max-h-[min(20rem,var(--radix-select-content-available-height))] min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-lg">
          <SelectPrimitive.Viewport className="p-1">
            {options.map((option, index) => <React.Fragment key={`${option.value}-${index}`}>
              {option.group && option.group !== options[index - 1]?.group && <div className="px-3 py-1.5 text-xs font-semibold text-muted-foreground">{option.group}</div>}
              <SelectPrimitive.Item value={`value:${option.value}`} disabled={option.disabled}
                className="relative flex min-h-9 cursor-default select-none items-center rounded-md py-2 pl-8 pr-3 text-sm outline-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-40">
                <SelectPrimitive.ItemIndicator className="absolute left-2"><Check className="size-4" /></SelectPrimitive.ItemIndicator>
                <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
              </SelectPrimitive.Item>
            </React.Fragment>)}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
    {invalid && <p role="alert" className="mt-1 text-xs text-destructive">Please choose an option.</p>}
  </div>;
});
