import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./components/dropdown-menu.tsx";

const onSignOut = fn();

const meta = {
  component: DropdownMenu,
  parameters: {
    a11y: {
      config: {
        rules: [
          // Base UI keeps focus inside an open menu with "focus guard"
          // spans: focusable but aria-hidden on purpose, which this rule
          // flags. Everything else is still checked.
          { id: "aria-hidden-focus", enabled: false },
        ],
      },
    },
  },
} satisfies Meta<typeof DropdownMenu>;
export default meta;
type Story = StoryObj<typeof meta>;

export const AccountMenu: Story = {
  render: () => (
    <DropdownMenu>
      <DropdownMenuTrigger className="rounded-md border px-3 py-1.5 text-sm">
        Account
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel>ada@example.com</DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem>Your account</DropdownMenuItem>
        <DropdownMenuItem onClick={onSignOut}>Sign out</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  ),
  play: async ({ canvas, canvasElement }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Account" }));
    // The menu renders in a portal, outside the story's canvas.
    const body = within(canvasElement.ownerDocument.body);
    await userEvent.click(
      await body.findByRole("menuitem", { name: "Sign out" }),
    );
    await expect(onSignOut).toHaveBeenCalledOnce();
  },
};
