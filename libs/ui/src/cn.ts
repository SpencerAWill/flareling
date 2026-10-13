import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Joins class names and resolves Tailwind conflicts, so a caller's
 * `className` can override a component's defaults: `cn("px-4", "px-2")` is
 * `"px-2"`. Accepts anything clsx does (strings, arrays, `{ class: bool }`).
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
