import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"
import { Slot } from "radix-ui"

// Restyled to DESIGN.md (UI-4, UI-13): capsule buttons, Body text, targets ≥ 44 px,
// primary 50 px, one tinted (default) button per view, destructive never the prominent
// style; a disabled button keeps its shape but takes the grey secondary fill (filled
// variants) and --label-3 text, so it is never a second prominent action. Light only.
const buttonVariants = cva(
  "group/button inline-flex max-w-full shrink-0 items-center justify-center gap-2 rounded-full border border-transparent text-base font-semibold text-center whitespace-normal transition-[background-color,opacity] duration-[var(--dur-press)] outline-none select-none focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:text-[var(--label-3)] aria-disabled:pointer-events-none aria-disabled:text-[var(--label-3)] [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-5",
  {
    variants: {
      variant: {
        // The one prominent action of a view.
        default:
          "bg-primary text-primary-foreground hover:bg-tint-pressed active:bg-tint-pressed disabled:bg-secondary aria-disabled:bg-secondary",
        // Plain actions: tinted text, no fill.
        plain: "bg-transparent text-primary hover:bg-accent",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary-pressed active:bg-secondary-pressed",
        outline: "border-input bg-background text-foreground hover:bg-muted",
        // Destructive: red text on a soft fill, never the prominent style.
        destructive: "bg-danger-soft text-destructive hover:bg-danger-pressed active:bg-danger-pressed disabled:bg-secondary aria-disabled:bg-secondary",
        link: "h-auto min-h-[var(--target)] text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "min-h-[var(--target)] px-5 [&[data-variant=link]]:px-0",
        lg: "min-h-[var(--button-primary)] px-6 w-full",
        icon: "size-[var(--target)]",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
