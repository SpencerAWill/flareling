import { createRouter } from "@tanstack/react-router";
import { ErrorPage } from "#/components/error-page.tsx";
import { NotFound } from "#/components/not-found.tsx";
import { routeTree } from "./routeTree.gen.ts";

export function getRouter() {
  return createRouter({
    routeTree,
    scrollRestoration: true,
    // Preload a route's code and loader data when a link is hovered or
    // focused. Stale time 0 leaves caching to the loaders themselves.
    defaultPreload: "intent",
    defaultPreloadStaleTime: 0,
    // Set on the router rather than per route, so routes added later inherit
    // them instead of falling back to the framework defaults.
    defaultErrorComponent: ErrorPage,
    defaultNotFoundComponent: NotFound,
  });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
