import { defineConfig } from "drizzle-kit";

// DATABASE_URL is configuration (ARCH-9); the fallback is the local Compose database.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema/index.ts",
  out: "./drizzle",
  dbCredentials: {
    url:
      process.env.DATABASE_URL ??
      "postgres://clinic:clinic_local_only@127.0.0.1:5432/clinic_dashboard",
  },
});
