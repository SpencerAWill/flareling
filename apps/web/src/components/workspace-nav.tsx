import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { useId } from "react";

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

/**
 * The workspace switcher and the workspace's sections. Switching keeps the
 * section you're on, so Billing in one workspace goes to Billing in the next.
 */
export function WorkspaceNav({
  current,
  workspaces,
}: {
  current: Workspace;
  workspaces: readonly Workspace[];
}) {
  const navigate = useNavigate();
  const selectId = useId();
  const { pathname } = useLocation();
  const section =
    SECTIONS.find((s) => pathname.endsWith(s.to.split("/").at(-1) ?? "")) ??
    SECTIONS[0];

  return (
    <header className="flex flex-col gap-3 border-b border-neutral-200 pb-4 dark:border-neutral-800">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Labelled by id rather than by wrapping: a wrapping label's name
            would include the selected option's text. */}
        <div className="flex items-center gap-2">
          <label htmlFor={selectId} className="text-sm font-medium">
            Workspace
          </label>
          <select
            id={selectId}
            value={current.publicId}
            onChange={(event) =>
              navigate({
                to: section.to,
                params: { publicId: event.target.value },
              })
            }
            className="rounded border border-neutral-300 px-2 py-1 dark:border-neutral-700 dark:bg-neutral-900"
          >
            {workspaces.map((w) => (
              <option key={w.id} value={w.publicId}>
                {w.personal ? `${w.name} (just you)` : w.name}
              </option>
            ))}
          </select>
        </div>
        <Link to="/my/account" className="text-sm underline">
          Your account
        </Link>
      </div>
      <nav aria-label="Workspace sections">
        <ul className="flex gap-4">
          {SECTIONS.map((s) => (
            <li key={s.to}>
              <Link
                to={s.to}
                params={{ publicId: current.publicId }}
                className="text-sm"
                activeProps={{
                  className: "font-semibold underline",
                  "aria-current": "page",
                }}
              >
                {s.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </header>
  );
}
