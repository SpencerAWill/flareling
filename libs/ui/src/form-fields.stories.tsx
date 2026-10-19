import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent } from "storybook/test";
import { Input } from "./components/input.tsx";
import { Label } from "./components/label.tsx";
import { NativeSelect } from "./native-select.tsx";

const meta = {
  title: "Form fields",
  component: Input,
} satisfies Meta<typeof Input>;
export default meta;
type Story = StoryObj<typeof meta>;

export const EmailAndRole: Story = {
  render: () => (
    <form className="flex max-w-sm flex-col gap-3">
      <div className="flex flex-col gap-2">
        <Label htmlFor="email">Email</Label>
        <Input id="email" type="email" placeholder="you@example.com" />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="role">Role</Label>
        <NativeSelect id="role" defaultValue="member">
          <option value="member">Member</option>
          <option value="admin">Admin</option>
        </NativeSelect>
      </div>
    </form>
  ),
  play: async ({ canvas }) => {
    const email = canvas.getByLabelText("Email");
    await userEvent.type(email, "ada@example.com");
    await expect(email).toHaveValue("ada@example.com");
    const role = canvas.getByLabelText("Role");
    await userEvent.selectOptions(role, "admin");
    await expect(role).toHaveValue("admin");
  },
};
