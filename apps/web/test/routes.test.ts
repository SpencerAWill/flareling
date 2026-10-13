import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

// Requests go through Start's real fetch handler in workerd, so these cover
// routing, SSR, and the router's not-found handling end to end.
describe("web worker", () => {
  it("serves the health check", async () => {
    const res = await exports.default.fetch("https://example.com/api/health");

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("server-renders the home page", async () => {
    const res = await exports.default.fetch("https://example.com/");

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toMatch(/^text\/html/);
    expect(await res.text()).toMatch(/^<!DOCTYPE html>/i);
  });

  it("returns 404 for unknown pages", async () => {
    const res = await exports.default.fetch("https://example.com/missing");

    expect(res.status).toBe(404);
    // Storage isolation requires every response body to be consumed.
    await res.text();
  });
});
