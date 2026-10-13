import AxeBuilder from "@axe-core/playwright";
import { test as base, expect, type Page } from "@playwright/test";

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
