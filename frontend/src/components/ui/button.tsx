import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[2px] border font-telemetry text-[11px] font-semibold uppercase tracking-[0.12em] ring-offset-background transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary-500/70 focus-visible:ring-offset-0 disabled:pointer-events-none disabled:opacity-45 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "border-primary-500/70 bg-primary-500/16 text-white hover:border-primary-400 hover:bg-primary-500/24",
        destructive:
          "border-signal-red/80 bg-signal-red/22 text-red-50 hover:border-signal-red hover:bg-signal-red/30",
        outline:
          "border-white/14 bg-black/25 text-zinc-200 hover:border-white/28 hover:bg-white/7.5 hover:text-white",
        secondary:
          "border-white/10 bg-white/4.5 text-zinc-200 hover:border-white/22 hover:bg-white/8 hover:text-white",
        ghost: "border-transparent bg-transparent text-zinc-400 hover:border-white/12 hover:bg-white/5.5 hover:text-white",
        link: "border-transparent bg-transparent px-0 text-primary-300 underline-offset-4 hover:text-primary-100 hover:underline",
      },
      size: {
        default: "h-9 px-3 py-2",
        sm: "h-8 px-2.5",
        lg: "h-10 px-4",
        icon: "h-9 w-9",
        xs: "h-7 px-2 text-[10px]",
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
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
