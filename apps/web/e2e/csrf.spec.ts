import { expect, test, waitForHydration } from "./fixtures.ts";

// Server functions must refuse calls from other sites. This captures the real
// request the sign-in form makes, then replays it as another site would.
test.skip(
  ({ browserName }) => browserName !== "chromium",
  "one engine is enough",
);

test("refuses a server function call from another site", async ({ page }) => {
  await page.goto("/sign-in");
  await waitForHydration(page);
  const requestPromise = page.waitForRequest((r) =>
    r.url().includes("/_serverFn/"),
  );
  await page.getByLabel("Email").fill(`csrf-${Date.now()}@example.com`);
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  const original = await requestPromise;
  await expect(page.getByRole("status")).toBeVisible();

  const replay = (headers: Record<string, string>) =>
    page.request.post(original.url(), {
      headers: { ...original.headers(), ...headers },
      data: original.postData() ?? "",
      failOnStatusCode: false,
    });

  for (const headers of [
    { "sec-fetch-site": "cross-site", origin: "https://evil.example" },
    // A sibling subdomain in a shared zone is "same-site", and still refused.
    { "sec-fetch-site": "same-site", origin: "https://other.example.com" },
  ]) {
    const res = await replay(headers);
    expect(res.status(), JSON.stringify(headers)).toBe(403);
    expect(res.headers()["x-frame-options"]).toBe("DENY");
  }

  // The same request from this origin is accepted.
  const same = await replay({ "sec-fetch-site": "same-origin" });
  expect(same.status()).toBe(200);
});
