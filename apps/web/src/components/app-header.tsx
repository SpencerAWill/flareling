import { buttonVariants } from "@flareling/ui";
import { Link, useRouteContext } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { Logo } from "./logo.tsx";
import { UserMenu } from "./user-menu.tsx";

/**
 * The bar across the top of signed-in pages: the logo, whatever the page
 * puts beside it (the workspace switcher), and the account menu.
 */
export function AppHeader({ children }: { children?: ReactNode }) {
  const { principal } = useRouteContext({ from: "__root__" });
  return (
    <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-5xl items-center gap-3 px-4 sm:px-6">
        <Logo />
        {children && (
          <>
            <span aria-hidden className="text-lg text-border select-none">
              /
            </span>
            {children}
          </>
        )}
        <div className="ml-auto flex items-center gap-2">
          {principal ? (
            <UserMenu principal={principal} />
          ) : (
            <Link
              to="/sign-in"
              className={buttonVariants({ variant: "secondary", size: "sm" })}
            >
              Sign in
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
