import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const badgeVariants = cva(
  [
    "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold",
    "transition-colors",
  ].join(" "),
  {
    variants: {
      variant: {
        default: "bg-[var(--soft-cloud)] text-[var(--ink)] border border-[var(--hairline)]",
        active: "bg-green-100 text-green-800 border border-green-300",
        inactive: "bg-gray-100 text-gray-600 border border-gray-300",
        destructive: "bg-red-100 text-red-800 border border-red-300",
        secondary: "bg-gray-100 text-gray-800 border border-gray-300",
        outline: "bg-transparent text-[var(--ink)] border border-[var(--hairline)]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { Badge, badgeVariants }
