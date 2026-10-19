import type { Page } from "@playwright/test";
import {
  expect,
  expectNoA11yViolations,
  signInByEmail,
  test,
  waitForHydration,
} from "./fixtures.ts";
import { latestLinkTo } from "./mailpit.ts";

async function createTeam(page: Page, name: string) {
  await page.getByLabel("New workspace").fill(name);
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page).toHaveURL(/\/w\/[0-9a-f-]+\/members$/);
  await waitForHydration(page);
}

test("an owner invites someone new, who signs up from the invite and joins", async ({
  page,
  browser,
}, testInfo) => {
  const stamp = `${testInfo.project.name}-${Date.now()}`;
  const ownerEmail = `e2e-invite-owner-${stamp}@example.com`;
  const inviteeEmail = `e2e-invitee-${stamp}@example.com`;
  const team = `Invite Team ${stamp}`;

  await signInByEmail(page, ownerEmail);
  await createTeam(page, team);
  await expect(page.getByText("1 of 3 seats used")).toBeVisible();

  await page.getByLabel("Email").fill(inviteeEmail);
  await page.getByLabel("Role", { exact: true }).selectOption("admin");
  await page.getByRole("button", { name: "Send invite" }).click();
  await expect(page.getByRole("status")).toHaveText(
    `Invite sent to ${inviteeEmail}.`,
  );
  await expect(
    page
      .getByRole("region", { name: "Open invites" })
      .getByRole("listitem")
      .filter({ hasText: inviteeEmail }),
  ).toContainText("Admin");
  await expect(page.getByText("2 of 3 seats used")).toBeVisible();
  await expectNoA11yViolations(page);

  const invite = await latestLinkTo(inviteeEmail, { pathname: "/invite" });
  const inviteHref = invite.pathname + invite.search;

  // The owner can't accept it: the invite is for another address.
  await page.goto(inviteHref);
  await waitForHydration(page);
  await expect(page.getByRole("alert")).toContainText(
    `this invite is for ${inviteeEmail}`,
  );

  // The invitee, in their own browser, with no account yet.
  const context = await browser.newContext();
  const invitee = await context.newPage();
  await invitee.goto(inviteHref);
  await waitForHydration(invitee);
  await expect(
    invitee.getByRole("heading", { name: `Join ${team}` }),
  ).toBeVisible();
  await expectNoA11yViolations(invitee);
  await invitee.getByRole("link", { name: "Sign in to accept" }).click();
  await expect(invitee).toHaveURL(/\/sign-in\?/);
  await waitForHydration(invitee);
  await expect(invitee.getByLabel("Email")).toHaveValue(inviteeEmail);
  await invitee
    .getByRole("button", { name: "Email me a sign-in link" })
    .click();
  await expect(invitee.getByRole("status")).toBeVisible();

  const signIn = await latestLinkTo(inviteeEmail, {
    pathname: "/auth/callback",
  });
  await invitee.goto(signIn.pathname + signIn.search);
  await waitForHydration(invitee);
  await invitee.getByRole("button", { name: "Continue" }).click();
  await expect(invitee).toHaveURL(/\/invite\?token=/);
  await waitForHydration(invitee);
  await invitee.getByRole("button", { name: "Accept and join" }).click();

  await expect(invitee).toHaveURL(/\/w\/[0-9a-f-]+\/members$/);
  await expect(
    invitee.getByRole("heading", { name: `Members of ${team}` }),
  ).toBeVisible();
  const members = invitee.getByRole("region", { name: /members?$/ });
  await expect(
    members.getByRole("listitem").filter({ hasText: inviteeEmail }),
  ).toContainText("Admin");
  await expect(
    members.getByRole("listitem").filter({ hasText: ownerEmail }),
  ).toContainText("Owner");
  await invitee.waitForLoadState("networkidle");
  await context.close();

  // Back with the owner: change the new admin's role, then remove them.
  await page.goto(invitee.url().replace(/^https?:\/\/[^/]+/, ""));
  await waitForHydration(page);
  // Wait for the change to be saved: reloading sooner would abort it...
  const saved = page.waitForResponse(
    (r) => r.request().method() === "POST" && r.url().includes("/_serverFn/"),
  );
  await page.getByLabel(`Role for ${inviteeEmail}`).selectOption("member");
  await saved;
  // ...and for the list refresh that follows (WebKit reports an aborted
  // request as "Load failed").
  await page.waitForLoadState("networkidle");
  await page.reload();
  await waitForHydration(page);
  await expect(page.getByLabel(`Role for ${inviteeEmail}`)).toHaveValue(
    "member",
  );

  // The only owner can't step down.
  await page.getByLabel(`Role for ${ownerEmail}`).selectOption("admin");
  await expect(page.getByRole("alert")).toHaveText(
    "A workspace needs an owner. Make someone else an owner first.",
  );
  await expect(page.getByLabel(`Role for ${ownerEmail}`)).toHaveValue("owner");

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: `Remove ${inviteeEmail}` }).click();
  await expect(page.getByText(inviteeEmail)).toHaveCount(0);
  await expect(page.getByText("1 of 3 seats used")).toBeVisible();
});

test("a revoked invite's link stops working", async ({ page }, testInfo) => {
  const stamp = `${testInfo.project.name}-${Date.now()}`;
  const inviteeEmail = `e2e-revoked-${stamp}@example.com`;
  await signInByEmail(page, `e2e-revoker-${stamp}@example.com`);
  await createTeam(page, `Revoke Team ${stamp}`);

  await page.getByLabel("Email").fill(inviteeEmail);
  await page.getByRole("button", { name: "Send invite" }).click();
  await expect(page.getByRole("status")).toBeVisible();
  const invite = await latestLinkTo(inviteeEmail, { pathname: "/invite" });

  await page
    .getByRole("button", { name: `Revoke the invite to ${inviteeEmail}` })
    .click();
  await expect(page.getByRole("region", { name: "Open invites" })).toHaveCount(
    0,
  );

  await page.goto(invite.pathname + invite.search);
  await expect(
    page.getByRole("heading", { name: "This invite is no longer valid" }),
  ).toBeVisible();
});

test("a used or unknown invite link says it's no longer valid", async ({
  page,
}) => {
  await page.goto("/invite?token=not-a-real-invite-token-at-all");
  await expect(
    page.getByRole("heading", { name: "This invite is no longer valid" }),
  ).toBeVisible();
});
