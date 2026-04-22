import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"
import { Spinner } from "./spinner"

const buttonVariants = cva(
  [
    "inline-flex items-center justify-center gap-2 whitespace-nowrap",
    "text-sm font-medium leading-none",
    "transition-all duration-150 ease-in-out",
    "cursor-pointer select-none",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3898ec] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background)]",
    "disabled:pointer-events-none disabled:opacity-40",
    "[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  ].join(" "),
  {
    variants: {
      variant: {
        /* ── Terracotta Brand — primary CTA ── */
        default:
          "bg-[#c96442] text-[#faf9f5] rounded-[0.75rem] px-4 py-2.5 " +
          "shadow-[0_0_0_1px_#c96442] " +
          "hover:bg-[#b85838] hover:shadow-[0_0_0_1px_#b85838] " +
          "active:scale-[0.97]",

        /* ── Warm secondary — works on both dark and light ── */
        secondary:
          "bg-[var(--surface-2)] text-[var(--warm-silver)] rounded-[0.625rem] px-4 py-2.5 " +
          "border border-[var(--border)] " +
          "hover:bg-[var(--surface-3)] hover:text-[var(--foreground)] hover:border-[var(--dark-warm)] " +
          "active:scale-[0.97]",

        /* ── Outline / ghost-border ── */
        outline:
          "bg-transparent text-[var(--foreground)] rounded-[0.625rem] px-4 py-2.5 " +
          "border border-[var(--border)] " +
          "hover:bg-[var(--accent)] hover:border-[var(--dark-warm)] " +
          "active:scale-[0.97]",

        /* ── Ghost — icon actions, low-emphasis ── */
        ghost:
          "bg-transparent text-[var(--muted-foreground)] rounded-[0.5rem] px-3 py-2 " +
          "hover:bg-[var(--accent)] hover:text-[var(--foreground)] " +
          "active:scale-[0.97]",

        /* ── Link ── */
        link:
          "bg-transparent text-[#d97757] underline-offset-4 rounded px-1 " +
          "hover:underline hover:text-[#c96442]",

        /* ── Destructive ── */
        destructive:
          "bg-[#b53333] text-[#faf9f5] rounded-[0.75rem] px-4 py-2.5 " +
          "hover:bg-[#9e2c2c] active:scale-[0.97]",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm:      "h-8 text-xs px-3 rounded-[0.5rem]",
        lg:      "h-10 px-6 text-base rounded-[0.875rem]",
        icon:    "h-9 w-9 p-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
  loading?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, loading, children, disabled, ...props }, ref) => {
    return (
      <button
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        disabled={disabled || loading}
        style={{ cursor: 'pointer', ...props.style }}
        {...props}
      >
        {loading && <Spinner size="sm" />}
        {children}
      </button>
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
