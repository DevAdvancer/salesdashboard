import * as React from "react"
import { cn } from "@/lib/utils"

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => (
    <textarea
      className={cn(
        "flex min-h-[80px] w-full",
        "rounded-[0.625rem] border border-border",
        "bg-[var(--input)] text-foreground placeholder:text-muted-foreground",
        "px-3 py-2 text-sm",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3898ec] focus-visible:border-[#3898ec]",
        "disabled:cursor-not-allowed disabled:opacity-40",
        "transition-all duration-150 resize-vertical",
        className
      )}
      ref={ref}
      {...props}
    />
  )
)
Textarea.displayName = "Textarea"

export { Textarea }
