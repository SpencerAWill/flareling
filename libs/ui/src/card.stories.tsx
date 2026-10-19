import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";
import { Button } from "./button.tsx";
import { Badge } from "./components/badge.tsx";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "./components/card.tsx";

const meta = { component: Card } satisfies Meta<typeof Card>;
export default meta;
type Story = StoryObj<typeof meta>;

export const WithEverything: Story = {
  render: () => (
    <Card className="max-w-sm">
      <CardHeader>
        <CardTitle>
          <h2>Current plan: Free</h2>
        </CardTitle>
        <CardDescription>Up to 3 members.</CardDescription>
        <CardAction>
          <Badge variant="secondary">Free</Badge>
        </CardAction>
      </CardHeader>
      <CardContent>Upgrade for 25 members and priority support.</CardContent>
      <CardFooter className="border-t">
        <Button variant="flare">Upgrade to Pro</Button>
      </CardFooter>
    </Card>
  ),
  play: async ({ canvas }) => {
    await expect(
      canvas.getByRole("heading", { name: "Current plan: Free" }),
    ).toBeVisible();
  },
};
