/**
 * The canonical origin the public site is addressed by.
 *
 * The apex is canonical: www.mastline.co answers with a 308 to mastline.co, so
 * every absolute URL we emit -- sitemap entries, robots.txt, Open Graph tags --
 * has to name the apex or search engines are handed the redirecting host.
 *
 * NEXT_PUBLIC_SITE_URL overrides it so a preview deployment describes itself
 * rather than production. VERCEL_URL is the per-deployment hostname Vercel sets
 * and carries no scheme.
 */
function resolveSiteUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL;
  if (explicit) return explicit.replace(/\/+$/, "");

  const vercel = process.env.VERCEL_URL;
  if (vercel) return `https://${vercel.replace(/\/+$/, "")}`;

  return "https://mastline.co";
}

export const SITE_URL = resolveSiteUrl();

/** Whether this deployment is the real site, as opposed to a preview build. */
export const IS_PRODUCTION_SITE =
  process.env.VERCEL_ENV === undefined || process.env.VERCEL_ENV === "production";

export function absoluteUrl(pathname: string): string {
  return pathname === "/" ? `${SITE_URL}/` : `${SITE_URL}${pathname}`;
}
