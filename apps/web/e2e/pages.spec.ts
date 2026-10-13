import { expect, expectNoA11yViolations, test } from "./fixtures.ts";

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

    // A client-side navigation, so this also proves the page hydrated.
    await page.getByRole("link", { name: "Go home" }).click();
    await expect(page).toHaveURL("/");
    await expect(
      page.getByRole("heading", { level: 1, name: "Flareling" }),
    ).toBeVisible();
  });

  test("has no accessibility violations", async ({ page }) => {
    await page.goto("/missing");
    await expectNoA11yViolations(page);
  });
});
