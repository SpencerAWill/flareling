import { cn } from "@flareling/ui";
import { Link } from "@tanstack/react-router";
import { FlameIcon } from "lucide-react";

/** The brand mark: a flame on the flare gradient. Decorative on its own. */
export function LogoMark({ className = "size-8" }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "grid shrink-0 place-items-center rounded-[28%] bg-flare text-white shadow-sm shadow-flare-to/30",
        className,
      )}
    >
      <FlameIcon className="size-[55%]" strokeWidth={2.25} />
    </span>
  );
}

/** The mark and wordmark, linking home. */
export function Logo() {
  return (
    <Link
      to="/"
      className="flex items-center gap-2 rounded-lg font-semibold tracking-tight outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <LogoMark />
      <span>Flareling</span>
    </Link>
  );
}

/**
 * A soft flare glow and a faded dot grid, behind a page's content. Purely
 * decorative; it sits under everything and takes no clicks.
 */
export function Backdrop() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 -z-10 overflow-hidden"
    >
      <div className="absolute top-[-18rem] left-1/2 h-[36rem] w-[56rem] -translate-x-1/2 rounded-full bg-flare opacity-[0.18] blur-3xl dark:opacity-[0.12]" />
      <div className="absolute inset-0 bg-[radial-gradient(var(--border)_1px,transparent_1px)] [mask-image:radial-gradient(ellipse_at_top,black,transparent_70%)] [background-size:22px_22px]" />
    </div>
  );
}
