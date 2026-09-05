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
  // Two on CI, not one. This used to be about exhaustion: all three projects
  // ran back to back against one `next start`, and by the third the server was
  // 404ing routes at random. CI now gives each project its own runner, its own
  // stack and its own server (.github/workflows/e2e-suite.yml), which removes
  // that cause -- but a hosted runner is still a small shared machine, and a
  // retry that passes is reported flaky rather than hidden, so real
  // instability stays visible either way.
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : [["list"]],

  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:4100",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },

  /*
   * Desktop runs everything. Tablet and mobile run what the width can change.
   *
   * Running all three projects over every spec was costing roughly three times
   * the wall clock to answer one question three times: whether a buyer template
   * saves, whether a 70/30 split is right, whether a token that was never
   * issued reveals nothing. None of that has a viewport dimension.
   *
   * So the gate is now opt-in and stated on the test:
   *
   *   @responsive  what it proves can differ with the width -- layout, overflow,
   *                what the navigation looks like, whether a control pinned to
   *                the bottom of the window is still reachable.
   *   @webkit      what it proves can differ with the engine. The mobile project
   *                is the only WebKit one, and Playwright's WebKit has no
   *                navigator.storage, so the import queue's persistence takes a
   *                different road there. That is a browser difference wearing a
   *                viewport's clothes, and it is tagged for what it is.
   *
   * An untagged test runs once, on desktop. Tagging is therefore the way to
   * widen coverage, and forgetting to tag narrows it -- so when a spec turns out
   * to be about layout after all, give it the tag rather than a project.
   */
  projects: [
    {
      // Signs the seeded roles in once and saves their cookies; every project
      // below depends on it. See e2e/auth.setup.ts.
      name: "setup",
      testMatch: /auth\.setup\.ts/,
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
      dependencies: ["setup"],
    },
    {
      name: "tablet",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1024, height: 768 } },
      grep: /@responsive/,
      dependencies: ["setup"],
    },
    {
      // iPhone-class, the size ACCEPTANCE names for the work queue and inspector.
      name: "mobile",
      use: { ...devices["iPhone 14 Pro"], viewport: { width: 390, height: 844 } },
      grep: /@responsive|@webkit/,
      dependencies: ["setup"],
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
