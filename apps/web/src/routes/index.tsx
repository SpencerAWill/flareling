import { buttonVariants, Card, CardContent } from "@flareling/ui";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowRightIcon,
  CreditCardIcon,
  RadioIcon,
  UsersIcon,
} from "lucide-react";
import { AppHeader } from "#/components/app-header.tsx";
import { Backdrop } from "#/components/logo.tsx";

export const Route = createFileRoute("/")({
  component: Home,
});

const FEATURES = [
  {
    icon: UsersIcon,
    title: "Workspaces",
    text: "Teams with owners, admins and members. Invite by email; seats follow the plan.",
  },
  {
    icon: RadioIcon,
    title: "Live",
    text: "See who's online and watch changes land, over Durable Object rooms that hibernate when idle.",
  },
  {
    icon: CreditCardIcon,
    title: "Billing",
    text: "Stripe Checkout and the customer portal, with webhooks through a queue.",
  },
] as const;

function Home() {
  const { principal } = Route.useRouteContext();
  return (
    <>
      <AppHeader />
      <main className="relative isolate">
        <Backdrop />
        <section className="mx-auto flex max-w-3xl flex-col items-center gap-6 px-6 pt-20 pb-16 text-center sm:pt-28">
          <p className="rounded-full border bg-card/70 px-3 py-1 text-xs font-medium text-muted-foreground shadow-xs backdrop-blur">
            A SaaS starter for Cloudflare's edge
          </p>
          <h1 className="text-flare text-6xl font-semibold tracking-tighter sm:text-7xl motion-safe:animate-in motion-safe:duration-700 motion-safe:zoom-in-95">
            Flareling
          </h1>
          <p className="max-w-xl text-lg text-balance text-muted-foreground">
            Workspaces, billing and realtime, running on Workers from the first
            commit. Costs close to nothing until you have traffic.
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            {principal ? (
              <Link
                to="/my/account"
                className={buttonVariants({ variant: "flare" })}
              >
                Open your workspaces <ArrowRightIcon />
              </Link>
            ) : (
              <Link
                to="/sign-in"
                className={buttonVariants({ variant: "flare" })}
              >
                Get started <ArrowRightIcon />
              </Link>
            )}
          </div>
        </section>
        <section
          aria-label="What's included"
          className="mx-auto grid max-w-4xl gap-4 px-6 pb-24 sm:grid-cols-3"
        >
          {FEATURES.map(({ icon: Icon, title, text }, i) => (
            <Card
              key={title}
              size="sm"
              className="motion-safe:animate-in motion-safe:duration-500 motion-safe:fill-mode-backwards motion-safe:slide-in-from-bottom-4"
              style={{ animationDelay: `${150 + i * 90}ms` }}
            >
              <CardContent className="gap-2">
                <span className="grid size-9 place-items-center rounded-lg bg-accent text-accent-foreground">
                  <Icon className="size-4.5" aria-hidden />
                </span>
                <h2 className="font-semibold">{title}</h2>
                <p className="text-muted-foreground">{text}</p>
              </CardContent>
            </Card>
          ))}
        </section>
      </main>
    </>
  );
}
