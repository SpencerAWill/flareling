import { ChevronDownIcon } from "lucide-react";
import type { ComponentProps } from "react";
import { cn } from "./cn.ts";

/**
 * A native `<select>` styled like Input, with a chevron. Native on purpose:
 * it's accessible, works without JavaScript, and phones show their own
 * picker. Use a Base UI Select only when options need more than text.
 */
export function NativeSelect({
  className,
  ...props
}: ComponentProps<"select">) {
  return (
    <span className="relative inline-flex">
      <select
        data-slot="native-select"
        className={cn(
          "h-9 w-full appearance-none rounded-md border border-input bg-transparent py-1 pr-8 pl-2.5 text-sm shadow-xs transition-[color,box-shadow] outline-none",
          "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30",
          className,
        )}
        {...props}
      />
      <ChevronDownIcon
        aria-hidden
        className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-muted-foreground"
      />
    </span>
  );
}
