import type { Meta, StoryObj } from "@storybook/react-vite";
import { Avatar, AvatarBadge, AvatarFallback } from "./components/avatar.tsx";

const meta = { component: Avatar } satisfies Meta<typeof Avatar>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Initials: Story = {
  render: () => (
    <div className="flex items-center gap-3">
      {(["sm", "default", "lg"] as const).map((size) => (
        <Avatar key={size} size={size}>
          <AvatarFallback>AL</AvatarFallback>
        </Avatar>
      ))}
    </div>
  ),
};

export const Online: Story = {
  render: () => (
    <Avatar>
      <AvatarFallback>AL</AvatarFallback>
      <AvatarBadge className="bg-success" />
    </Avatar>
  ),
};
