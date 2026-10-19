import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@flareling/ui";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { CheckIcon, ChevronsUpDownIcon, PlusIcon } from "lucide-react";
import { motion } from "motion/react";
import { WorkspaceTile } from "./avatars.tsx";

interface Workspace {
  readonly id: string;
  readonly publicId: string;
  readonly name: string;
  readonly personal: boolean;
}

const SECTIONS = [
  { to: "/w/$publicId/members", label: "Members" },
  { to: "/w/$publicId/billing", label: "Billing" },
] as const;

/** The section of the workspace the current page is, from its path. */
function useSection() {
  const { pathname } = useLocation();
  return (
    SECTIONS.find((s) => pathname.endsWith(s.to.split("/").at(-1) ?? "")) ??
    SECTIONS[0]
  );
}

/**
 * The current workspace, opening a menu of the others. Switching keeps the
 * section you're on, so Billing in one workspace goes to Billing in the next.
 */
export function WorkspaceSwitcher({
  current,
  workspaces,
}: {
  current: Workspace;
  workspaces: readonly Workspace[];
}) {
  const navigate = useNavigate();
  const section = useSection();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 text-sm font-medium outline-none transition-colors hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50 data-popup-open:bg-accent">
        <WorkspaceTile name={current.name} personal={current.personal} />
        <span className="truncate">{current.name}</span>
        <span className="sr-only">(switch workspace)</span>
        <ChevronsUpDownIcon
          aria-hidden
          className="size-4 shrink-0 text-muted-foreground"
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-64">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="text-xs text-muted-foreground">
            Workspaces
          </DropdownMenuLabel>
          {workspaces.map((w) => (
            <DropdownMenuItem
              key={w.id}
              onClick={() =>
                navigate({ to: section.to, params: { publicId: w.publicId } })
              }
            >
              <WorkspaceTile name={w.name} personal={w.personal} />
              <span className="min-w-0 flex-1 truncate">
                {w.name}
                {w.personal && (
                  <span className="text-muted-foreground"> (just you)</span>
                )}
              </span>
              {w.id === current.id && <CheckIcon aria-label="Current" />}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => navigate({ to: "/my/account" })}>
          <PlusIcon />
          New workspace
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The workspace's sections, with an underline that slides between them. */
export function WorkspaceTabs({ current }: { current: Workspace }) {
  const section = useSection();
  return (
    <nav aria-label="Workspace sections" className="border-b">
      <ul className="mx-auto flex max-w-5xl gap-6 px-4 sm:px-6">
        {SECTIONS.map((s) => (
          <li key={s.to}>
            <Link
              to={s.to}
              params={{ publicId: current.publicId }}
              // Each color in its own state: as two classes on one element,
              // the CSS order (not the class order) would pick the winner.
              className="relative block py-3 text-sm font-medium outline-none transition-colors hover:text-foreground focus-visible:text-foreground"
              activeProps={{
                className: "text-foreground",
                "aria-current": "page",
              }}
              inactiveProps={{ className: "text-muted-foreground" }}
            >
              {s.label}
              {section === s && (
                <motion.span
                  layoutId="workspace-section"
                  transition={{ type: "spring", bounce: 0.2, duration: 0.4 }}
                  className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-flare"
                />
              )}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
