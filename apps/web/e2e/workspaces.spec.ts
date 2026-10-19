import {
  expect,
  expectNoA11yViolations,
  signInByEmail,
  test,
  waitForHydration,
} from "./fixtures.ts";

test("someone creates a team workspace and switches between workspaces", async ({
  page,
}, testInfo) => {
  const email = `e2e-workspace-${testInfo.project.name}-${Date.now()}@example.com`;
  await signInByEmail(page, email);

  await page.getByLabel("New workspace").fill("E2E Team");
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page).toHaveURL(/\/w\/[0-9a-z]{10}\/members$/);
  await waitForHydration(page);
  await expect(
    page.getByRole("heading", { name: "Members of E2E Team" }),
  ).toBeVisible();
  await expect(
    page.getByRole("listitem").filter({ hasText: email }),
  ).toContainText("Owner");
  await expectNoA11yViolations(page);

  // Switching keeps the section: Billing here goes to Billing there.
  await page.getByRole("link", { name: "Billing" }).click();
  await expect(page).toHaveURL(/\/billing$/);
  await page
    .getByLabel("Workspace", { exact: true })
    .selectOption({ label: "Personal (just you)" });
  await expect(
    page.getByRole("heading", { name: "Billing for Personal" }),
  ).toBeVisible();
});

test("someone else's workspace is not found", async ({ page }, testInfo) => {
  await signInByEmail(
    page,
    `e2e-workspace-404-${testInfo.project.name}-${Date.now()}@example.com`,
  );
  const res = await page.goto(
    "/w/01900000-0000-7000-8000-000000000000/members",
  );
  expect(res?.status()).toBe(404);
});
