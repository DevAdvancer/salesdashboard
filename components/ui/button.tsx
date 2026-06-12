import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"
import { Spinner } from "./spinner"

const buttonVariants = cva(
  [
    "inline-flex items-center justify-center gap-2 whitespace-nowrap",
    "text-sm font-medium leading-normal",
    "transition-all duration-150 ease-out",
    "cursor-pointer select-none",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ink)] focus-visible:ring-offset-[12px] focus-visible:ring-offset-[var(--soft-cloud)]",
    "disabled:pointer-events-none disabled:opacity-40",
    "[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  ].join(" "),
  {
    variants: {
      variant: {
        default:
          "bg-[var(--ink)] text-[var(--canvas)] rounded-full px-8 py-3 shadow-none hover:bg-[var(--charcoal)] active:scale-[0.97] active:opacity-90",
        secondary:
          "bg-[var(--soft-cloud)] text-[var(--ink)] rounded-full border border-transparent px-8 py-3 hover:bg-[var(--hairline-soft)] active:scale-[0.97] active:opacity-90",
        outline:
          "bg-[var(--canvas)] text-[var(--ink)] rounded-full border border-[var(--hairline)] px-6 py-2.5 hover:bg-[var(--soft-cloud)] hover:border-[var(--ash)] active:scale-[0.97] active:opacity-90",
        ghost:
          "bg-transparent text-[var(--mute)] rounded-full px-3 py-2 hover:bg-[var(--accent)] hover:text-[var(--foreground)] active:scale-[0.97] active:opacity-90",
        link:
          "bg-transparent text-[var(--ink)] underline-offset-4 rounded-none px-1 hover:underline hover:text-[var(--charcoal)]",
        destructive:
          "bg-[var(--sale)] text-[var(--canvas)] rounded-full px-8 py-3 hover:bg-[var(--sale-deep)] active:scale-[0.97] active:opacity-90",
      },
      size: {
        default: "h-12 px-8 py-3",
        sm: "h-10 text-sm px-4 rounded-full",
        lg: "h-12 px-8 text-base rounded-full",
        icon: "h-10 w-10 rounded-full p-0",
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
        style={{ cursor: "pointer", ...props.style }}
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
