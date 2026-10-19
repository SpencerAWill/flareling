/**
 * Server functions for workspaces and their members. Thin shells, as in
 * src/server/auth/fns.ts: validate, then call libs/core through a dynamic
 * import, which checks the principal's role itself. Results are values, so
 * pages can say what went wrong; a workspace the principal can't see is
 * `{ ok: false }`, whether or not it exists.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const workspaceInput = z.object({ workspaceId: z.uuid() });

async function signedIn() {
  const { getPrincipal } = await import("@flareling/auth");
  const { authContext } = await import("../auth/context.server.ts");
  return getPrincipal(authContext());
}

/** Runs `run`, turning a refused or anonymous request into `{ ok: false }`. */
async function unlessRefused<T>(
  run: () => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false }> {
  const { ForbiddenError, UnauthorizedError } = await import("@flareling/auth");
  try {
    return { ok: true, value: await run() };
  } catch (err) {
    if (err instanceof ForbiddenError || err instanceof UnauthorizedError) {
      return { ok: false };
    }
    throw err;
  }
}

/** Creates a team workspace owned by the signed-in account. */
export const createWorkspaceFn = createServerFn({ method: "POST" })
  .validator(z.object({ name: z.string().max(200) }))
  .handler(async ({ data }) => {
    const { createWorkspace } = await import("@flareling/core");
    const principal = await signedIn();
    if (!principal)
      return { ok: false as const, reason: "unauthorized" as const };
    return createWorkspace(principal, data.name);
  });

/** The workspace's members, for any member. */
export const listMembersFn = createServerFn({ method: "GET" })
  .validator(workspaceInput)
  .handler(async ({ data }) => {
    const { listMembers } = await import("@flareling/core");
    const principal = await signedIn();
    const result = await unlessRefused(() =>
      listMembers(principal, data.workspaceId),
    );
    if (!result.ok) return result;
    return {
      ok: true as const,
      members: result.value.map((m) => ({
        ...m,
        // ISO strings: Start's serializer and the client both handle them.
        joinedAt: m.joinedAt.toISOString(),
      })),
    };
  });
