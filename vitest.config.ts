import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

const alias = { "@": fileURLToPath(new URL("./src", import.meta.url)) };

// See tests/stubs/server-only.ts for why this alias exists and what it does not
// weaken.
const databaseAlias = {
  ...alias,
  "server-only": fileURLToPath(new URL("./tests/stubs/server-only.ts", import.meta.url)),
};

/**
 * Two kinds of test, run differently.
 *
 * Unit and component tests are pure and run in parallel in jsdom.
 *
 * The tests under tests/ share one local Postgres and one seeded organization,
 * so they run serially: parallel files were interfering through workspace-wide
 * totals. They skip themselves cleanly when .env.local is absent, so a checkout
 * without Docker still passes `npm run test`.
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const supabaseEnv = {
    NEXT_PUBLIC_SUPABASE_URL: env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
    SUPABASE_SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY ?? "",
    SUPABASE_TEST_PASSWORD: env.SUPABASE_TEST_PASSWORD ?? "mastline-dev-password",
  };

  return {
    plugins: [react()],
    resolve: { alias },
    test: {
      coverage: { provider: "v8", include: ["src/lib/**/*.ts"] },
      // Root level, not per project: Vitest treats fileParallelism as a runner
      // option, so setting it inside a project block has no effect. The
      // database tests share one Postgres and one seeded workspace, and running
      // their files concurrently produced a rare failure where one file summed
      // storage while another was writing versions.
      fileParallelism: false,
      projects: [
        {
          plugins: [react()],
          resolve: { alias },
          test: {
            name: "unit",
            environment: "jsdom",
            globals: true,
            setupFiles: ["./vitest.setup.ts"],
            include: ["src/**/*.{test,spec}.{ts,tsx}"],
            env: supabaseEnv,
          },
        },
        {
          resolve: { alias: databaseAlias },
          test: {
            name: "database",
            environment: "node",
            globals: true,
            include: ["tests/**/*.{test,spec}.ts"],
            env: supabaseEnv,
            // One database, one seeded organization: these must not overlap.
            sequence: { concurrent: false },
          },
        },
      ],
    },
  };
});
