import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"
import { Spinner } from "./spinner"

const buttonVariants = cva(
  "inline-flex items-center justify-center whitespace-nowrap rounded-full transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-gradient-to-br from-[var(--info)] to-[var(--info-deep)] text-white shadow-md hover:shadow-lg hover:opacity-90",
        glass: "glass-button",
        secondary: "bg-[var(--soft-cloud)] text-foreground hover:bg-black/5 dark:hover:bg-white/5",
        outline: "border border-input bg-background hover:bg-accent hover:text-accent-foreground",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
        destructive: "bg-[var(--sale)] text-white shadow-sm hover:bg-[var(--sale-deep)]",
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
    if (variant === "glass") {
      return (
        <div className={cn("glass-button-wrap rounded-full", (disabled || loading) ? "cursor-not-allowed opacity-50" : "cursor-pointer", className)}>
          <button
            className={cn("w-full h-full", buttonVariants({ variant, size }))}
            ref={ref}
            disabled={disabled || loading}
            {...props}
          >
            <span className="glass-button-text flex items-center justify-center gap-2 w-full h-full whitespace-nowrap">
              {loading ? (
                <>
                  <Spinner size="sm" />
                  <span>Loading...</span>
                </>
              ) : (
                children
              )}
            </span>
          </button>
          <div className="glass-button-shadow rounded-full"></div>
        </div>
      )
    }

    return (
      <button
        className={cn(buttonVariants({ variant, size }), className)}
        ref={ref}
        disabled={disabled || loading}
        {...props}
      >
        {loading ? (
          <span className="flex items-center justify-center gap-2">
            <Spinner size="sm" />
            <span>Loading...</span>
          </span>
        ) : (
          children
        )}
      </button>
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
