import { buttonVariants } from "@flareling/ui";
import { Link } from "@tanstack/react-router";
import { Backdrop } from "./logo.tsx";

export function NotFound() {
  return (
    <main className="relative isolate grid min-h-dvh place-items-center px-6 text-center">
      <Backdrop />
      <div className="flex flex-col items-center gap-4">
        <p
          aria-hidden
          className="text-flare text-8xl font-semibold tracking-tighter"
        >
          404
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">
          Page not found
        </h1>
        <p className="max-w-sm text-muted-foreground">
          It may have moved, or you may not have access to it.
        </p>
        <Link to="/" className={buttonVariants({ variant: "secondary" })}>
          Go home
        </Link>
      </div>
    </main>
  );
}
