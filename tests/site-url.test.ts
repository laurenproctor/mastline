import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * SITE_URL is resolved once at module load, so each case has to reset the
 * module registry and import it again under different environment variables.
 *
 * The case that matters is production: VERCEL_URL is set there as well as on
 * previews, holding the deployment's own hostname rather than the domain
 * visitors use. Preferring it published a sitemap and og:image tags naming
 * mastline-<hash>-<org>.vercel.app, which is what this locks shut.
 */

const ORIGINAL = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL };
  vi.resetModules();
});

async function loadSiteUrl(env: Record<string, string | undefined>): Promise<string> {
  vi.resetModules();
  for (const key of ["NEXT_PUBLIC_SITE_URL", "VERCEL_URL", "VERCEL_ENV"]) {
    delete process.env[key];
  }
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) process.env[key] = value;
  }
  return (await import("@/lib/site")).SITE_URL;
}

describe("SITE_URL", () => {
  it("names the apex on a production deployment, not the deployment hostname", async () => {
    const url = await loadSiteUrl({
      VERCEL_ENV: "production",
      VERCEL_URL: "mastline-4z4hvkd6h-lauren-proctors-projects.vercel.app",
    });

    expect(url).toBe("https://mastline.co");
  });

  it("lets a preview describe itself", async () => {
    const url = await loadSiteUrl({
      VERCEL_ENV: "preview",
      VERCEL_URL: "mastline-git-branch-org.vercel.app",
    });

    expect(url).toBe("https://mastline-git-branch-org.vercel.app");
  });

  it("falls back to the apex off Vercel entirely", async () => {
    expect(await loadSiteUrl({})).toBe("https://mastline.co");
  });

  it("prefers an explicit override, without a trailing slash", async () => {
    const url = await loadSiteUrl({
      NEXT_PUBLIC_SITE_URL: "https://staging.mastline.co/",
      VERCEL_ENV: "preview",
      VERCEL_URL: "mastline-git-branch-org.vercel.app",
    });

    expect(url).toBe("https://staging.mastline.co");
  });
});
