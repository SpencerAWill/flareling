import { Avatar, AvatarBadge, AvatarFallback, cn } from "@flareling/ui";

/** A stable hue for `key`, so a person or workspace keeps its color. */
function hueOf(key: string): number {
  let hash = 0;
  for (const char of key) hash = (hash * 31 + char.charCodeAt(0)) % 360;
  return hash;
}

/** `key`'s color: dark enough for white text at AA contrast, whatever the hue. */
function colorOf(key: string): string {
  return `oklch(0.47 0.13 ${hueOf(key)})`;
}

/**
 * Two letters from an address: "ada.lovelace@..." is AL, "ada@..." is AD.
 * A "+tag" isn't part of the name: "ada+work@..." is AD.
 */
function initialsOf(email: string): string {
  const local = email.split("@")[0]?.split("+")[0] || email;
  const parts = local.split(/[._+-]+/).filter(Boolean);
  const letters =
    parts.length > 1
      ? `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}`
      : local.slice(0, 2);
  return letters.toUpperCase();
}

/**
 * A person's initials on their own color, with a green dot while they have
 * the workspace open. Decorative: the address is always written beside it.
 */
export function MemberAvatar({
  email,
  online = false,
  size = "default",
}: {
  email: string;
  online?: boolean;
  size?: "sm" | "default" | "lg";
}) {
  return (
    <Avatar size={size} aria-hidden>
      <AvatarFallback
        className="font-medium text-white"
        style={{ backgroundColor: colorOf(email) }}
      >
        {initialsOf(email)}
      </AvatarFallback>
      {online && (
        <AvatarBadge className="bg-success motion-safe:animate-pulse" />
      )}
    </Avatar>
  );
}

/** A workspace's first letter on a rounded square of its own color. */
export function WorkspaceTile({
  name,
  personal = false,
  className = "size-6 text-xs",
}: {
  name: string;
  personal?: boolean;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "grid shrink-0 place-items-center rounded-md font-semibold text-white",
        personal && "bg-flare",
        className,
      )}
      style={personal ? undefined : { backgroundColor: colorOf(name) }}
    >
      {name.trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
}
