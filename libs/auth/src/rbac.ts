/**
 * Permission checks. A permission is a name like `roles:manage`; a principal
 * holds the union of its roles' grants, and `system_admin` holds every
 * permission, including ones added after it was granted.
 *
 * Server code always checks the real principal. UI checks are for display
 * only and never a substitute.
 */

/** Who is making the request, loaded once per request by `getPrincipal`. */
export interface Principal {
  readonly userId: string;
  readonly primaryEmail: string;
  readonly emails: readonly string[];
  /** Role names (`system_admin`, `member`). */
  readonly roles: readonly string[];
  /** Permission names. For a system admin, every permission that exists. */
  readonly permissions: readonly string[];
  readonly isSystemAdmin: boolean;
}

/** No one is signed in. Maps to HTTP 401 or a redirect to sign-in. */
export class UnauthorizedError extends Error {
  constructor() {
    super("Not signed in");
    this.name = "UnauthorizedError";
  }
}

/** Signed in, but without the permission. Maps to HTTP 403 (or a 404). */
export class ForbiddenError extends Error {
  readonly permission: string;

  constructor(permission: string) {
    super(`Missing permission ${permission}`);
    this.name = "ForbiddenError";
    this.permission = permission;
  }
}

export function hasPermission(
  principal: Principal | null,
  permission: string,
): boolean {
  if (!principal) return false;
  return principal.isSystemAdmin || principal.permissions.includes(permission);
}

export function hasAnyPermission(
  principal: Principal | null,
  permissions: readonly string[],
): boolean {
  return permissions.some((p) => hasPermission(principal, p));
}

/** The principal, or UnauthorizedError. */
export function requirePrincipal(principal: Principal | null): Principal {
  if (!principal) throw new UnauthorizedError();
  return principal;
}

/** The principal if it holds `permission`; otherwise Unauthorized or Forbidden. */
export function requirePermission(
  principal: Principal | null,
  permission: string,
): Principal {
  const p = requirePrincipal(principal);
  if (!hasPermission(p, permission)) throw new ForbiddenError(permission);
  return p;
}

/**
 * The principal if it holds any of `permissions`. How a write permission
 * implies its read counterpart: the OR is stated at the check, not modeled.
 */
export function requireAnyPermission(
  principal: Principal | null,
  permissions: readonly string[],
): Principal {
  const p = requirePrincipal(principal);
  if (!hasAnyPermission(p, permissions)) {
    throw new ForbiddenError(permissions.join(" | "));
  }
  return p;
}
