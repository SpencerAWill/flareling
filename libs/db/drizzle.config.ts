import { defineConfig } from "drizzle-kit";

// Schema-only: `drizzle-kit generate` reads the schema and writes SQL
// migrations, and `wrangler d1 migrations apply` applies them (locally, and
// in deploys). No driver or credentials, because drizzle-kit never talks to a
// remote database here.
export default defineConfig({
  schema: "./src/schema.ts",
  out: "./migrations",
  dialect: "sqlite",
});
