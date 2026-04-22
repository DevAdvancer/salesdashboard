import * as React from "react"
import { cn } from "@/lib/utils"

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          // Layout
          "flex h-10 w-full",
          // Shape
          "rounded-[0.625rem] border border-border",
          // Colors — fully CSS-variable driven
          "bg-[var(--input)] text-foreground placeholder:text-muted-foreground",
          // Spacing
          "px-3 py-2 text-sm",
          // File input
          "file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground file:cursor-pointer",
          // Focus — the only blue moment
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3898ec] focus-visible:border-[#3898ec]",
          // Transitions
          "transition-all duration-150",
          // Disabled
          "disabled:cursor-not-allowed disabled:opacity-40",
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Input.displayName = "Input"

export { Input }
