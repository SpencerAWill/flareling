import type { Meta, StoryObj } from "@storybook/react-vite";
import { Badge } from "./components/badge.tsx";

const meta = {
  component: Badge,
  args: { children: "Owner" },
} satisfies Meta<typeof Badge>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Secondary: Story = { args: { variant: "secondary" } };
export const Outline: Story = { args: { variant: "outline" } };
export const Success: Story = {
  args: {
    className: "bg-success/15 text-success-foreground",
    children: "Online",
  },
};
