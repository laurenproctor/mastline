import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

/**
 * Unit and component tests run in jsdom and need nothing external.
 *
 * The tests under tests/ talk to a real local Supabase stack. They read
 * .env.local, and skip themselves cleanly when it is absent so that a
 * checkout without Docker still passes `npm run test`.
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  return {
    plugins: [react()],
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
      },
    },
    test: {
      environment: "jsdom",
      globals: true,
      setupFiles: ["./vitest.setup.ts"],
      include: ["src/**/*.{test,spec}.{ts,tsx}", "tests/**/*.{test,spec}.ts"],
      env: {
        NEXT_PUBLIC_SUPABASE_URL: env.NEXT_PUBLIC_SUPABASE_URL ?? "",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
        SUPABASE_SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY ?? "",
        SUPABASE_TEST_PASSWORD: env.SUPABASE_TEST_PASSWORD ?? "mastline-dev-password",
      },
      coverage: {
        provider: "v8",
        include: ["src/lib/**/*.ts"],
      },
    },
  };
});
