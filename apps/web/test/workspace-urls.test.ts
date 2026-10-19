import { applyD1Migrations } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import { signedIn, workspaceWith } from "./session.ts";

// Workspace pages are addressed by public id, through Start's real fetch
// handler (server rendering, the /w/$publicId layout's resolution).

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

const get = (path: string, cookie: string) =>
  exports.default.fetch(`https://example.com${path}`, {
    headers: { Cookie: cookie },
    redirect: "manual",
  });

describe("/w/$publicId", () => {
  it("renders a member's workspace by its public id", async () => {
    const { userId, cookie } = await signedIn();
    const { publicId } = await workspaceWith(userId);
    const res = await get(`/w/${publicId}/members`, cookie);
    expect(res.status).toBe(200);
    // React marks the boundary between adjacent text nodes when rendering.
    expect(await res.text()).toMatch(/Members of (<!-- -->)?Team/);
  });

  it("sends old links by internal id to the public one, keeping the rest", async () => {
    const { userId, cookie } = await signedIn();
    const { id, publicId } = await workspaceWith(userId);
    const res = await get(`/w/${id}/billing?checkout=success`, cookie);
    expect(res.status).toBe(307);
    expect(res.headers.get("Location")).toBe(
      `/w/${publicId}/billing?checkout=success`,
    );
  });

  it("is a 404 for a workspace the account isn't in, by either id", async () => {
    const owner = await signedIn();
    const { id, publicId } = await workspaceWith(owner.userId);
    const outsider = await signedIn();
    for (const path of [`/w/${publicId}/members`, `/w/${id}/members`]) {
      const res = await get(path, outsider.cookie);
      expect(res.status, path).toBe(404);
      await res.text();
    }
  });
});
