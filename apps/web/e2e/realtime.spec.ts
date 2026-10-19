import type { Browser, Page } from "@playwright/test";
import { expect, signInByEmail, test, waitForHydration } from "./fixtures.ts";
import { latestLinkTo } from "./mailpit.ts";

// apps/realtime runs beside the app in `vite preview` (vite.config.ts), so
// these go through real rooms. Not against deployed environments: they need
// Mailpit to get a second person into the workspace.
test.skip(Boolean(process.env.E2E_BASE_URL), "needs Mailpit");

/** Signs someone new up from an invite in their own browser; ends on members. */
async function joinFromInvite(browser: Browser, email: string): Promise<Page> {
  const invite = await latestLinkTo(email, { pathname: "/invite" });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(invite.pathname + invite.search);
  await waitForHydration(page);
  await page.getByRole("link", { name: "Sign in to accept" }).click();
  await waitForHydration(page);
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await expect(page.getByRole("status")).toBeVisible();
  const signIn = await latestLinkTo(email, { pathname: "/auth/callback" });
  await page.goto(signIn.pathname + signIn.search);
  await waitForHydration(page);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/invite\?token=/);
  await waitForHydration(page);
  await page.getByRole("button", { name: "Accept and join" }).click();
  await expect(page).toHaveURL(/\/w\/[0-9a-z]{10}\/members$/);
  await waitForHydration(page);
  return page;
}

const row = (page: Page, email: string) =>
  page
    .getByRole("region", { name: /members?$/ })
    .getByRole("listitem")
    .filter({ hasText: email });

test("members see each other online, and membership changes arrive without a reload", async ({
  page,
  browser,
}, testInfo) => {
  const stamp = `${testInfo.project.name}-${Date.now()}-${testInfo.repeatEachIndex}`;
  const ownerEmail = `e2e-rt-owner-${stamp}@example.com`;
  const memberEmail = `e2e-rt-member-${stamp}@example.com`;

  await signInByEmail(page, ownerEmail);
  await page.getByLabel("New workspace").fill(`Realtime ${stamp}`);
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page).toHaveURL(/\/w\/[0-9a-z]{10}\/members$/);
  await waitForHydration(page);
  await expect(row(page, ownerEmail)).toContainText("Online");
  await expect(page.getByText("1 online now")).toBeVisible();

  await page.getByLabel("Email").fill(memberEmail);
  await page.getByRole("button", { name: "Send invite" }).click();
  await expect(page.getByRole("status")).toBeVisible();

  const member = await joinFromInvite(browser, memberEmail);

  // The owner's page, untouched since: the new member appears, online.
  await expect(row(page, memberEmail)).toContainText("Online");
  await expect(page.getByText("2 online now")).toBeVisible();
  await expect(row(member, ownerEmail)).toContainText("Online");

  // Promoted to admin: the member's own page gains the admin controls.
  await page.getByLabel(`Role for ${memberEmail}`).selectOption("admin");
  await expect(member.getByLabel(`Role for ${memberEmail}`)).toHaveValue(
    "admin",
  );

  // Removed: their socket is closed and their page says the workspace is gone.
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: `Remove ${memberEmail}` }).click();
  await expect(row(page, memberEmail)).toHaveCount(0);
  await expect(
    member.getByRole("heading", { name: "Page not found" }),
  ).toBeVisible();
  await expect(page.getByText("1 online now")).toBeVisible();

  await member.context().close();
});
