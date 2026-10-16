import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: Home,
});

function Home() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center gap-4 px-6">
      <h1 className="text-4xl font-semibold tracking-tight">Flareling</h1>
      <p className="text-lg text-neutral-600 dark:text-neutral-400">
        A multi-app SaaS suite running on Cloudflare. Edit{" "}
        <code className="font-mono text-base">apps/web/src/routes</code> to get
        started.
      </p>
      <Link to="/account" className="self-start underline">
        Your account
      </Link>
    </main>
  );
}
