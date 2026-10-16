import { createRootRoute, HeadContent, Scripts } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { getSessionFn } from "#/server/auth/fns.ts";
import appCss from "#/styles.css?url";

export const Route = createRootRoute({
  // Who's signed in, for every route's guards and UI (context.principal).
  // Server functions still check for themselves; this is for navigation.
  beforeLoad: async () => ({ principal: await getSessionFn() }),
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Flareling" },
      {
        name: "description",
        content: "A multi-app SaaS suite running on Cloudflare.",
      },
    ],
    links: [{ rel: "stylesheet", href: appCss }],
  }),
  // The HTML document every route renders inside. As a shell component it
  // also wraps the error and not-found pages, so they get the stylesheet too.
  shellComponent: RootDocument,
});

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}
