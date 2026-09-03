import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"
import { Spinner } from "./spinner"

const buttonVariants = cva(
  "glass-button relative isolate cursor-pointer rounded-full transition-all disabled:pointer-events-none disabled:opacity-40",
  {
    variants: {
      variant: {
        default: "",
        secondary: "bg-[var(--soft-cloud)]",
        outline: "",
        ghost: "bg-transparent border-transparent box-shadow-none",
        link: "bg-transparent underline-offset-4 hover:underline",
        destructive: "bg-[var(--sale)] border-[var(--sale)]",
      },
      size: {
        default: "px-8 py-3 h-12 text-base font-medium",
        sm: "px-6 py-2.5 h-10 text-sm font-medium",
        lg: "px-10 py-4 h-14 text-lg font-medium",
        icon: "h-10 w-10 p-0 flex items-center justify-center",
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
      <div className={cn("glass-button-wrap cursor-pointer rounded-full", className)}>
        <button
          className={cn("w-full h-full", buttonVariants({ variant, size }))}
          ref={ref}
          disabled={disabled || loading}
          style={{ cursor: "pointer", ...props.style }}
          {...props}
        >
          <span className="glass-button-text flex items-center justify-center gap-2 w-full h-full">
            {loading && <Spinner size="sm" />}
            {children}
          </span>
        </button>
        <div className="glass-button-shadow rounded-full"></div>
      </div>
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
