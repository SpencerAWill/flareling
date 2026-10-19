import { Button } from "@flareling/ui";
import { type ErrorComponentProps, useRouter } from "@tanstack/react-router";
import { TriangleAlertIcon } from "lucide-react";
import { Backdrop } from "./logo.tsx";

/**
 * Router-wide error boundary. The error message is shown only in development:
 * in production it can carry internals (queries, stack details) that should
 * reach the logs, not the visitor.
 */
export function ErrorPage({ error, reset }: ErrorComponentProps) {
  const router = useRouter();

  return (
    <main className="relative isolate grid min-h-dvh place-items-center px-6 text-center">
      <Backdrop />
      <div className="flex max-w-md flex-col items-center gap-4">
        <span className="grid size-12 place-items-center rounded-full bg-destructive/10 text-destructive">
          <TriangleAlertIcon className="size-6" aria-hidden />
        </span>
        <h1 className="text-2xl font-semibold tracking-tight">
          Something went wrong
        </h1>
        {import.meta.env.DEV && (
          <pre className="w-full overflow-x-auto rounded-lg bg-muted p-4 text-left text-sm">
            {error instanceof Error ? error.message : String(error)}
          </pre>
        )}
        <Button
          variant="secondary"
          onClick={() => {
            reset();
            // Fire and forget: a failed reload lands back in this boundary.
            void router.invalidate();
          }}
        >
          Try again
        </Button>
      </div>
    </main>
  );
}
