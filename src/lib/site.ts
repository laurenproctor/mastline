/**
 * The canonical origin the public site is addressed by.
 *
 * The apex is canonical: www.mastline.co answers with a 308 to mastline.co, so
 * every absolute URL we emit -- sitemap entries, robots.txt, Open Graph tags --
 * has to name the apex or search engines are handed the redirecting host.
 *
 * NEXT_PUBLIC_SITE_URL overrides everything, for a deployment that has to
 * describe itself as something else.
 *
 * VERCEL_URL is only consulted for previews, and that distinction is the whole
 * point of the check. It is the per-deployment hostname and Vercel sets it on
 * production too, where it holds the deployment's own address rather than the
 * domain visitors use -- so preferring it unconditionally, as this did on first
 * release, published a sitemap, a robots.txt Sitemap: line, and og:image tags
 * that all named mastline-<hash>-<org>.vercel.app instead of mastline.co.
 */
function resolveSiteUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL;
  if (explicit) return explicit.replace(/\/+$/, "");

  const preview = process.env.VERCEL_URL;
  if (process.env.VERCEL_ENV === "preview" && preview) {
    return `https://${preview.replace(/\/+$/, "")}`;
  }

  return "https://mastline.co";
}

export const SITE_URL = resolveSiteUrl();

/** Whether this deployment is the real site, as opposed to a preview build. */
export const IS_PRODUCTION_SITE =
  process.env.VERCEL_ENV === undefined || process.env.VERCEL_ENV === "production";

export function absoluteUrl(pathname: string): string {
  return pathname === "/" ? `${SITE_URL}/` : `${SITE_URL}${pathname}`;
}
