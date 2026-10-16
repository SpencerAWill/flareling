import { expect, test, waitForHydration } from "./fixtures.ts";
import { latestLinkTo } from "./mailpit.ts";

test("signs in with an emailed link, and out again", async ({
  page,
}, testInfo) => {
  const email = `e2e-${testInfo.project.name}-${Date.now()}@example.com`;

  await page.goto("/my/account");
  await expect(page).toHaveURL(/\/sign-in\?redirect=%2Fmy%2Faccount/);
  await waitForHydration(page);
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await expect(page.getByRole("status")).toContainText("Check your email");

  // Open the emailed link on this server, whatever host the email names.
  const link = await latestLinkTo(email);
  await page.goto(link.pathname + link.search);
  await waitForHydration(page);
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page).toHaveURL(/\/my\/account$/);
  await expect(page.getByText(`Signed in as ${email}`)).toBeVisible();
  // A new account gets a personal workspace, which it owns.
  await expect(
    page.getByRole("listitem").filter({ hasText: "Personal" }),
  ).toContainText("Personal (owner)");

  await page.getByRole("button", { name: "Sign out" }).click();
  // Wait for the home page to finish loading before leaving it: navigating
  // away mid-load aborts its requests, which the router logs as an error.
  await expect(page.getByRole("link", { name: "Your account" })).toBeVisible();
  await page.goto("/my/account");
  await expect(page).toHaveURL(/\/sign-in/);
});

test("refuses a link that was already used", async ({ page }, testInfo) => {
  const email = `e2e-reuse-${testInfo.project.name}-${Date.now()}@example.com`;
  await page.goto("/sign-in");
  await waitForHydration(page);
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await expect(page.getByRole("status")).toBeVisible();
  const link = await latestLinkTo(email);

  await page.goto(link.pathname + link.search);
  await waitForHydration(page);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/my\/account$/);
  await expect(page.getByText(`Signed in as ${email}`)).toBeVisible();

  await page.context().clearCookies();
  await page.goto(link.pathname + link.search);
  await waitForHydration(page);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "expired or has already been used",
  );
});
