import { describe, expect, it } from "vitest";
import {
  securityHeaders,
  withSecurityHeaders,
} from "#/server/security-headers.ts";

describe("withSecurityHeaders", () => {
  it("copies a response whose headers can't be changed, instead of throwing", () => {
    const redirect = Response.redirect("https://example.com/next", 302);
    const result = withSecurityHeaders(redirect);
    expect(result.status).toBe(302);
    expect(result.headers.get("Location")).toBe("https://example.com/next");
    for (const [name, value] of Object.entries(securityHeaders)) {
      expect(result.headers.get(name), name).toBe(value);
    }
  });

  it("keeps a header the response set itself", () => {
    const res = new Response(null, {
      headers: { "Referrer-Policy": "no-referrer" },
    });
    expect(withSecurityHeaders(res).headers.get("Referrer-Policy")).toBe(
      "no-referrer",
    );
  });
});
