import { describe, expect, it } from "vitest";
import { addMember, createUser } from "../test/users.ts";
import { createWorkspace, listMembers } from "./index.ts";

async function teamOwnedBy(name = "Acme") {
  const owner = await createUser();
  const result = await createWorkspace(owner, name);
  if (!result.ok) throw new Error("setup: workspace not created");
  return { owner, workspaceId: result.id };
}

describe("listMembers", () => {
  it("lists every member with their primary address and role, earliest first", async () => {
    const { owner, workspaceId } = await teamOwnedBy();
    const member = await createUser();
    await addMember(workspaceId, member.userId, "member");

    expect(await listMembers(member, workspaceId)).toEqual([
      {
        userId: owner.userId,
        email: owner.primaryEmail,
        role: "owner",
        joinedAt: expect.any(Date),
      },
      {
        userId: member.userId,
        email: member.primaryEmail,
        role: "member",
        joinedAt: expect.any(Date),
      },
    ]);
  });

  it("refuses a non-member, as if the workspace didn't exist", async () => {
    const { workspaceId } = await teamOwnedBy();
    await expect(
      listMembers(await createUser(), workspaceId),
    ).rejects.toMatchObject({ name: "ForbiddenError" });
  });
});
