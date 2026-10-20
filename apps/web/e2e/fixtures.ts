import AxeBuilder from "@axe-core/playwright";
import { test as base, expect, type Page } from "@playwright/test";
import { latestLinkTo } from "./mailpit.ts";

/**
 * Every test fails if the page logs a console error or throws. That is how a
 * hydration mismatch or a broken client chunk shows up: the server-rendered
 * HTML looks fine and only the browser console knows.
 *
 * One exception: browsers log a page that is itself served as an error (the
 * 404 page) as "Failed to load resource". Those are skipped for top-level
 * navigations only, so a missing script or stylesheet still fails the test.
 */
export const test = base.extend<{ consoleErrors: string[] }>({
  consoleErrors: [
    async ({ page }, use) => {
      const errors: string[] = [];
      const errorDocuments = new Set<string>();
      page.on("response", (response) => {
        if (
          response.request().isNavigationRequest() &&
          response.status() >= 400
        ) {
          errorDocuments.add(response.url());
        }
      });
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => {
        if (message.type() !== "error") return;
        const isErrorDocument =
          message.text().startsWith("Failed to load resource") &&
          errorDocuments.has(message.location().url);
        if (!isErrorDocument) errors.push(message.text());
      });
      await use(errors);
      expect(errors, "console errors or uncaught exceptions").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

/** WCAG 2.1 A and AA, the level most accessibility regulations reference. */
export async function expectNoA11yViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(results.violations).toEqual([]);
}

/**
 * Waits for TanStack Start to finish hydrating. Interacting earlier hits the
 * server-rendered HTML before React has attached its handlers: a link click
 * becomes a full page load, and input typed into a controlled field is wiped
 * when React reconciles. Adapted from ucmc.spencerwill.com, where premature
 * interaction was the source of every E2E flake.
 *
 * Start serializes a `window.$_TSR` object into the page, sets `hydrated` on it
 * once React has reconciled, and deletes it when the stream ends, so either
 * state means hydration is done. Call it after `page.goto()` and before the
 * first interaction.
 */
export async function waitForHydration(page: Page, timeoutMs = 10_000) {
  await page.waitForFunction(
    () => {
      const tsr = (window as { $_TSR?: { hydrated?: boolean } }).$_TSR;
      return tsr === undefined || tsr.hydrated === true;
    },
    null,
    { timeout: timeoutMs },
  );
}

/**
 * Signs in as `email` with a magic link from Mailpit, ending on /my/account
 * once it has rendered: leaving a page mid-request aborts its requests, which
 * WebKit reports as "TypeError: Load failed".
 */
export async function signInByEmail(page: Page, email: string) {
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
  // The URL changes as the client-side navigation starts; the heading shows
  // once its code and data have loaded. (networkidle doesn't help here: it
  // tracks full page loads, not client-side navigations.)
  await expect(
    page.getByRole("heading", { level: 1, name: "Your account" }),
  ).toBeVisible();
}
