import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center rounded-xs border px-2 py-0.5 font-telemetry text-3xs font-semibold uppercase tracking-[0.12em] transition-colors focus:outline-hidden focus:ring-2 focus:ring-primary-500/50 focus:ring-offset-0",
  {
    variants: {
      variant: {
        default:
          "border-primary-500/50 bg-primary-500/12 text-primary-100 hover:bg-primary-500/18",
        secondary:
          "border-white/12 bg-white/4.5 text-zinc-300 hover:bg-white/7.5",
        destructive:
          "border-signal-red/70 bg-signal-red/18 text-red-50 hover:bg-signal-red/24",
        outline: "border-white/14 bg-transparent text-zinc-300",
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
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  )
}

export { Badge, badgeVariants }
