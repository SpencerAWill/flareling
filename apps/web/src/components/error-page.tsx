import { type ErrorComponentProps, useRouter } from "@tanstack/react-router";

/**
 * Router-wide error boundary. The error message is shown only in development:
 * in production it can carry internals (queries, stack details) that should
 * reach the logs, not the visitor.
 */
export function ErrorPage({ error, reset }: ErrorComponentProps) {
  const router = useRouter();

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center gap-4 px-6">
      <h1 className="text-2xl font-semibold">Something went wrong</h1>
      {import.meta.env.DEV && (
        <pre className="overflow-x-auto rounded bg-neutral-100 p-4 text-sm dark:bg-neutral-900">
          {error instanceof Error ? error.message : String(error)}
        </pre>
      )}
      <button
        type="button"
        className="self-start rounded border px-4 py-2"
        onClick={() => {
          reset();
          router.invalidate();
        }}
      >
        Try again
      </button>
    </main>
  );
}
