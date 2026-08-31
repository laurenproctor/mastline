import { defineConfig, devices } from "@playwright/test";

/**
 * Browser tests.
 *
 * These exist to check the things no amount of parsing HTML can: that layouts
 * hold at the sizes docs/ACCEPTANCE.md requires, that focus is visible, and
 * that client-rendered states -- error boundaries, the billing toggle -- behave
 * for someone actually using them.
 *
 * They run against a production build, because that is what a photographer
 * will use and because dev-mode overlays hide exactly the failures worth
 * catching.
 */
export default defineConfig({
  testDir: "./e2e",
  // A shared database means these must not overlap.
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  // Two on CI, not one: the mobile project runs last, against a `next start`
  // that has been hammered for twenty minutes on a small runner, and by then
  // the server itself 404s routes at random -- the same exhaustion pattern
  // known from loaded dev machines. A retry that passes is still reported
  // flaky, so real instability stays visible.
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : [["list"]],

  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:4100",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },

  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
    {
      name: "tablet",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1024, height: 768 } },
    },
    {
      // iPhone-class, the size ACCEPTANCE names for the work queue and inspector.
      name: "mobile",
      use: { ...devices["iPhone 14 Pro"], viewport: { width: 390, height: 844 } },
    },
  ],

  // Pointing E2E_BASE_URL at a deployment means there is nothing to start
  // locally; starting one anyway would test the wrong build.
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: "npx next start -p 4100",
        url: "http://127.0.0.1:4100/welcome",
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
