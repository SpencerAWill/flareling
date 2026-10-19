import {
  expect,
  expectNoA11yViolations,
  signInByEmail,
  test,
} from "./fixtures.ts";
import { stripeSignature } from "./stripe.ts";

// Against the local preview only, which talks to stripe-mock with a known
// webhook secret. A deployed environment has Stripe keys this suite doesn't
// hold. stripe-mock is stateless, so plan changes aren't visible here;
// libs/billing's tests cover processing.
test.skip(Boolean(process.env.E2E_BASE_URL), "needs stripe-mock");

test("an owner sees the workspace's plan and goes to Stripe Checkout to upgrade", async ({
  page,
}, testInfo) => {
  await signInByEmail(
    page,
    `e2e-billing-${testInfo.project.name}-${Date.now()}@example.com`,
  );

  await page.getByRole("link", { name: "Billing" }).click();
  await expect(page).toHaveURL(/\/w\/[0-9a-z]{10}\/billing$/);
  await expect(
    page.getByRole("heading", { name: "Current plan: Free" }),
  ).toBeVisible();
  await expectNoA11yViolations(page);

  // stripe-mock answers with a real-looking Checkout URL; the browser stops
  // at a stand-in page there rather than reaching Stripe.
  await page.route(/^https:\/\/checkout\.stripe\.com\//, (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Stripe Checkout</title>",
    }),
  );
  await page.getByRole("button", { name: "Upgrade to Pro, monthly" }).click();
  await expect(page).toHaveURL(/^https:\/\/checkout\.stripe\.com\//);
});

test("someone else's workspace is not found", async ({ page }, testInfo) => {
  await signInByEmail(
    page,
    `e2e-billing-404-${testInfo.project.name}-${Date.now()}@example.com`,
  );
  const res = await page.goto(
    "/w/01900000-0000-7000-8000-000000000000/billing",
  );
  expect(res?.status()).toBe(404);
});

test.describe("the Stripe webhook", () => {
  const payload = JSON.stringify({
    id: `evt_e2e_${Date.now()}`,
    object: "event",
    type: "customer.subscription.updated",
    data: { object: { id: "sub_e2e", object: "subscription" } },
  });

  test("accepts a signed event", async ({ request }) => {
    const res = await request.post("/api/stripe/webhook", {
      headers: {
        "Content-Type": "application/json",
        "Stripe-Signature": stripeSignature(payload),
      },
      data: Buffer.from(payload),
    });
    expect(res.status()).toBe(200);
    expect(await res.json()).toEqual({ received: true });
  });

  test("refuses a bad signature", async ({ request }) => {
    const res = await request.post("/api/stripe/webhook", {
      headers: {
        "Content-Type": "application/json",
        "Stripe-Signature": stripeSignature(payload, "whsec_wrong"),
      },
      data: Buffer.from(payload),
    });
    expect(res.status()).toBe(400);
  });
});
