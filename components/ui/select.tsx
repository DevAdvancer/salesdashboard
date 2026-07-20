"use client";

import * as React from "react";
import { ChevronDown, Check } from "lucide-react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

interface SelectContextValue {
  value: string;
  onValueChange: (value: string) => void;
  open: boolean;
  setOpen: (open: boolean) => void;
  disabled?: boolean;
}

const SelectContext = React.createContext<SelectContextValue | null>(null);

function useSelectContext() {
  const ctx = React.useContext(SelectContext);
  if (!ctx) throw new Error("Select components must be used within <Select>");
  return ctx;
}

// ---------------------------------------------------------------------------
// Select root
// ---------------------------------------------------------------------------

interface SelectProps {
  value: string;
  onValueChange: (value: string) => void;
  children: React.ReactNode;
  disabled?: boolean;
}

export function Select({ value, onValueChange, children, disabled }: SelectProps) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  // Close on outside click
  React.useEffect(() => {
    if (!open) return;
    const handlePointerDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <SelectContext.Provider value={{ value, onValueChange, open, setOpen, disabled }}>
      <div className="relative" ref={ref}>
        {children}
      </div>
    </SelectContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// SelectTrigger
// ---------------------------------------------------------------------------

interface SelectTriggerProps {
  className?: string;
  children: React.ReactNode;
  id?: string;
  disabled?: boolean;
}

export function SelectTrigger({ className, children, id, disabled }: SelectTriggerProps) {
  const { open, setOpen, disabled: contextDisabled } = useSelectContext();
  const isDisabled = disabled || contextDisabled;
  return (
    <button
      id={id}
      type="button"
      aria-haspopup="listbox"
      aria-expanded={open}
      onClick={() => {
        if (!isDisabled) setOpen(!open);
      }}
      disabled={isDisabled}
      className={cn(
        "flex items-center justify-between gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
    >
      {children}
      <ChevronDown
        className={cn(
          "h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200",
          open && "rotate-180",
        )}
      />
    </button>
  );
}

// ---------------------------------------------------------------------------
// SelectValue
// ---------------------------------------------------------------------------

interface SelectValueProps {
  placeholder?: string;
}

export function SelectValue({ placeholder }: SelectValueProps) {
  const { value } = useSelectContext();
  // We render the label of the selected item by letting SelectItem register itself
  return (
    <SelectValueRenderer placeholder={placeholder} currentValue={value} />
  );
}

// We use a registry to collect item labels
const LabelRegistryContext = React.createContext<Map<string, string>>(new Map());

function SelectValueRenderer({
  placeholder,
  currentValue,
}: {
  placeholder?: string;
  currentValue: string;
}) {
  const registry = React.useContext(LabelRegistryContext);
  const label = registry.get(currentValue);
  if (!label && !currentValue) {
    return (
      <span className="text-muted-foreground">{placeholder ?? "Select…"}</span>
    );
  }
  return <span>{label ?? currentValue}</span>;
}

// ---------------------------------------------------------------------------
// SelectContent
// ---------------------------------------------------------------------------

interface SelectContentProps {
  className?: string;
  children: React.ReactNode;
}

export function SelectContent({ className, children }: SelectContentProps) {
  const { open } = useSelectContext();
  const [registry] = React.useState(() => new Map<string, string>());

  if (!open) return null;

  return (
    <LabelRegistryContext.Provider value={registry}>
      <div
        role="listbox"
        className={cn(
          "absolute left-0 top-full z-50 mt-1 min-w-full overflow-hidden rounded-md border border-border bg-popover text-popover-foreground shadow-lg",
          "animate-in fade-in-0 zoom-in-95",
          className,
        )}
      >
        <div className="py-1">{children}</div>
      </div>
    </LabelRegistryContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// SelectItem
// ---------------------------------------------------------------------------

interface SelectItemProps {
  value: string;
  className?: string;
  children: React.ReactNode;
}

export function SelectItem({ value, className, children }: SelectItemProps) {
  const { value: selectedValue, onValueChange, setOpen } = useSelectContext();
  const registry = React.useContext(LabelRegistryContext);
  const label =
    typeof children === "string"
      ? children
      : React.Children.toArray(children)
          .filter((c) => typeof c === "string")
          .join("") || value;

  // Register label in the parent registry so SelectValue can display it
  registry.set(value, label);

  const isSelected = selectedValue === value;

  return (
    <button
      type="button"
      role="option"
      aria-selected={isSelected}
      onClick={() => {
        onValueChange(value);
        setOpen(false);
      }}
      className={cn(
        "flex w-full cursor-default select-none items-center gap-2 px-3 py-2 text-sm outline-none",
        "hover:bg-accent hover:text-accent-foreground",
        isSelected && "bg-accent/50 font-medium",
        className,
      )}
    >
      <Check
        className={cn(
          "h-3.5 w-3.5 shrink-0",
          isSelected ? "opacity-100" : "opacity-0",
        )}
      />
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// SelectGroup / SelectLabel (bonus helpers)
// ---------------------------------------------------------------------------

export function SelectGroup({ children }: { children: React.ReactNode }) {
  return <div role="group">{children}</div>;
}

export function SelectLabel({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "px-3 py-1.5 text-xs font-semibold text-muted-foreground",
        className,
      )}
    >
      {children}
    </div>
  );
}
