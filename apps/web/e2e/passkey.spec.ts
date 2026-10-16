import { expect, test, waitForHydration } from "./fixtures.ts";
import { latestLinkTo } from "./mailpit.ts";

// Real WebAuthn ceremonies against a virtual authenticator, driven through the
// Chrome DevTools Protocol. WebKit has no equivalent, so Chromium only.
test.skip(({ browserName }) => browserName !== "chromium", "needs CDP");

test("adds a passkey, then signs in with it", async ({ page }, testInfo) => {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });

  // Sign in by email first, then add the passkey.
  const email = `e2e-passkey-${testInfo.project.name}-${Date.now()}@example.com`;
  await page.goto("/sign-in");
  await waitForHydration(page);
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await expect(page.getByRole("status")).toBeVisible();
  const link = await latestLinkTo(email);
  await page.goto(link.pathname + link.search);
  await waitForHydration(page);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/account$/);
  await waitForHydration(page);

  await page.getByRole("button", { name: "Add a passkey" }).click();
  await expect(page.getByRole("status")).toHaveText("Passkey added.");
  await expect(page.getByRole("button", { name: "Remove" })).toHaveCount(1);

  // Signed out, the passkey alone gets back in.
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.goto("/sign-in");
  await waitForHydration(page);
  await page.getByRole("button", { name: "Sign in with a passkey" }).click();
  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByText(`Signed in as ${email}`)).toBeVisible();
});
