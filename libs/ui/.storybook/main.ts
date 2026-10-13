import type { StorybookConfig } from "@storybook/react-vite";
import tailwindcss from "@tailwindcss/vite";

const config: StorybookConfig = {
  framework: "@storybook/react-vite",
  // No usage telemetry, as with WRANGLER_SEND_METRICS in check-worker-size.
  core: { disableTelemetry: true },
  stories: ["../src/**/*.stories.tsx"],
  // addon-a11y runs axe on every story, in the Storybook UI and (with
  // `a11y.test` in preview.ts) as part of each story's test. addon-vitest
  // turns stories into Vitest browser tests (see vitest.config.ts).
  addons: ["@storybook/addon-a11y", "@storybook/addon-vitest"],
  // libs/ui has no vite.config.ts of its own (apps bundle it), so Tailwind is
  // added here for Storybook and its tests.
  viteFinal: (viteConfig) => ({
    ...viteConfig,
    plugins: [...(viteConfig.plugins ?? []), tailwindcss()],
  }),
};

export default config;
