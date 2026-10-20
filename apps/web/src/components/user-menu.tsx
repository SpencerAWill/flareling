import type { Principal } from "@flareling/auth/client";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@flareling/ui";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { LogOutIcon, UserIcon } from "lucide-react";
import { afterSessionChange } from "#/lib/auth.ts";
import { signOutFn } from "#/server/auth/fns.ts";
import { MemberAvatar } from "./avatars.tsx";

/** The signed-in person's avatar, opening their account and sign-out. */
export function UserMenu({ principal }: { principal: Principal }) {
  const navigate = useNavigate();
  const router = useRouter();
  const signOut = useServerFn(signOutFn);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Account menu"
        className="rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <MemberAvatar email={principal.primaryEmail} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="truncate font-normal text-muted-foreground">
            {principal.primaryEmail}
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => navigate({ to: "/my/account" })}>
          <UserIcon />
          Your account
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={async () => {
            await signOut();
            await afterSessionChange(router, "/");
          }}
        >
          <LogOutIcon />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
