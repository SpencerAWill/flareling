import { securityHeaders } from "../src/server/security-headers.ts";
import { expect, test, waitForHydration } from "./fixtures.ts";

// The post-deploy check (`@smoke`, with pages.spec.ts): run against a deployed
// environment by the deploy workflow, and locally with the rest of the suite.
// Nothing here signs in: a deployed environment's sign-in emails go to real
// inboxes the suite can't read.
//
// Every request here is a browser page load. The zone's Bot Fight Mode
// challenges anything else from a CI runner's IP (Playwright's `request`,
// and the page's own fetches to server functions), and on Cloudflare's Free
// plan no rule can exempt it (flareling#14). So the smoke tests check what a
// page load can: the Worker answers, sends its headers, renders, and
// hydrates. Client-side behavior stays in the local suite.
test.describe("a deployed environment", { tag: "@smoke" }, () => {
  test("answers its health check", async ({ page }) => {
    const res = await page.goto("/api/health");
    expect(res?.status()).toBe(200);
    expect(await res?.json()).toEqual({ status: "ok" });
  });

  test("sends the security headers", async ({ page }) => {
    const res = await page.goto("/");
    const headers = res?.headers() ?? {};
    for (const [name, value] of Object.entries(securityHeaders)) {
      expect(headers[name.toLowerCase()], name).toBe(value);
    }
  });

  test("hydrates the home page", async ({ page }) => {
    await page.goto("/");
    await waitForHydration(page);
    await expect(
      page.getByRole("heading", { level: 1, name: "Flareling" }),
    ).toBeVisible();
  });

  test.describe("rendered on the server", () => {
    // With JavaScript, the sign-in page starts a passkey ceremony (a server
    // function call, challenged in CI) and its button waits for a Turnstile
    // token, which a headless browser on a datacenter IP may never get.
    test.use({ javaScriptEnabled: false });

    test("sends signed-out visitors to sign in", async ({ page }) => {
      await page.goto("/my/account");
      await expect(page).toHaveURL(/\/sign-in\?redirect=%2Fmy%2Faccount/);
      await expect(page.getByLabel("Email")).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Email me a sign-in link" }),
      ).toBeVisible();
    });
  });
});
