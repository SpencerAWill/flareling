import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "./cn.ts";

const buttonVariants = cva(
  [
    "inline-flex shrink-0 items-center justify-center gap-2 rounded-lg text-sm font-medium whitespace-nowrap transition-all",
    "outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
    "disabled:pointer-events-none disabled:opacity-50",
    "active:translate-y-px [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  ],
  {
    variants: {
      variant: {
        primary:
          "bg-primary text-primary-foreground shadow-xs hover:bg-primary/90",
        // The brand gradient: one per screen, for its main call to action.
        flare:
          "bg-flare text-white shadow-sm shadow-flare-to/20 hover:brightness-105 hover:shadow-md hover:shadow-flare-to/25",
        secondary:
          "border border-input bg-card shadow-xs hover:bg-accent hover:text-accent-foreground",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        destructive:
          "border border-destructive/30 bg-card text-destructive shadow-xs hover:bg-destructive/10",
      },
      size: {
        default: "h-9 px-4",
        sm: "h-8 px-3 text-xs",
        icon: "size-9",
      },
    },
    defaultVariants: { variant: "primary", size: "default" },
  },
);

export interface ButtonProps
  extends ComponentProps<"button">,
    VariantProps<typeof buttonVariants> {}

/**
 * A native `<button>` with the suite's styling. `type` defaults to `"button"`
 * rather than the browser's `"submit"`, so a button inside a form never
 * submits it by accident. A `className` passed in wins over the defaults.
 */
export function Button({
  variant,
  size,
  type = "button",
  className,
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}

/** The button look for something that isn't a `<button>`, such as a link. */
export { buttonVariants };
