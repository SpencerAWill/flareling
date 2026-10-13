import {
  expect,
  expectNoA11yViolations,
  test,
  waitForHydration,
} from "./fixtures.ts";

test.describe("home", () => {
  test("renders", async ({ page }) => {
    await page.goto("/");

    await expect(page).toHaveTitle("Flareling");
    await expect(
      page.getByRole("heading", { level: 1, name: "Flareling" }),
    ).toBeVisible();
  });

  test("has no accessibility violations", async ({ page }) => {
    await page.goto("/");
    await expectNoA11yViolations(page);
  });
});

test.describe("not found", () => {
  test("returns 404 and links home", async ({ page }) => {
    const response = await page.goto("/missing");
    expect(response?.status()).toBe(404);

    // The router must handle the click without a full page load, which only
    // happens once the page has hydrated. A value set on `window` survives a
    // client-side navigation and is lost on a reload.
    await waitForHydration(page);
    await page.evaluate(() => {
      (window as { e2eMarker?: boolean }).e2eMarker = true;
    });
    await page.getByRole("link", { name: "Go home" }).click();
    await expect(page).toHaveURL("/");
    await expect(
      page.getByRole("heading", { level: 1, name: "Flareling" }),
    ).toBeVisible();
    expect(
      await page.evaluate(() => (window as { e2eMarker?: boolean }).e2eMarker),
    ).toBe(true);
  });

  test("has no accessibility violations", async ({ page }) => {
    await page.goto("/missing");
    await expectNoA11yViolations(page);
  });
});
