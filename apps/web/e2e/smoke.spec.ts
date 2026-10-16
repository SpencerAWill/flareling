import { securityHeaders } from "../src/server/security-headers.ts";
import { expect, test, waitForHydration } from "./fixtures.ts";

// The post-deploy check (`@smoke`, with pages.spec.ts): run against a deployed
// environment by the deploy workflow, and locally with the rest of the suite.
// Nothing here signs in: a deployed environment's sign-in emails go to real
// inboxes the suite can't read.
test.describe("a deployed environment", { tag: "@smoke" }, () => {
  test("answers its health check", async ({ request }) => {
    const res = await request.get("/api/health");
    expect(res.status()).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  test("sends the security headers", async ({ request }) => {
    const res = await request.get("/");
    for (const [name, value] of Object.entries(securityHeaders)) {
      expect(res.headers()[name.toLowerCase()], name).toBe(value);
    }
  });

  test("sends signed-out visitors to sign in, which renders", async ({
    page,
  }) => {
    await page.goto("/my/account");
    await expect(page).toHaveURL(/\/sign-in\?redirect=%2Fmy%2Faccount/);
    await waitForHydration(page);
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Email me a sign-in link" }),
    ).toBeEnabled();
  });
});
