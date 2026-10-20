import { Card, CardContent, CardHeader } from "@flareling/ui";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { Backdrop, LogoMark } from "./logo.tsx";

/**
 * The centered card the sign-in, link and invite pages share: the mark, a
 * heading, an optional line under it, and the page's content. It slides in;
 * no fade, so text is at full contrast from the first frame.
 */
export function AuthShell({
  title,
  description,
  children,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <main className="relative isolate grid min-h-dvh place-items-center px-4 py-12">
      <Backdrop />
      <div className="w-full max-w-sm motion-safe:animate-in motion-safe:duration-500 motion-safe:slide-in-from-bottom-3">
        <Link
          to="/"
          aria-label="Flareling home"
          className="mx-auto mb-6 block w-fit rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <LogoMark className="size-11" />
        </Link>
        <Card className="shadow-lg shadow-black/5">
          <CardHeader className="text-center">
            <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
            {description && (
              <p className="text-sm text-muted-foreground">{description}</p>
            )}
          </CardHeader>
          <CardContent className="gap-4">{children}</CardContent>
        </Card>
      </div>
    </main>
  );
}
