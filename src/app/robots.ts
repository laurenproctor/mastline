import type { MetadataRoute } from "next";
import { PROTECTED_ROUTES } from "@/lib/routes";
import { IS_PRODUCTION_SITE, SITE_URL, absoluteUrl } from "@/lib/site";

/**
 * robots.txt, built from the same gated-route list the middleware enforces, so
 * adding a protected area disallows it here without a second edit.
 *
 * A preview deployment refuses everything: preview hostnames are public, and a
 * crawled preview competes with production for the same copy.
 */
export const dynamic = "force-static";

export default function robots(): MetadataRoute.Robots {
  if (!IS_PRODUCTION_SITE) {
    return { rules: [{ userAgent: "*", disallow: "/" }] };
  }

  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          ...PROTECTED_ROUTES.map((route) => `${route}/`),
          // Tokenised delivery links are held by picture desks and are not
          // public documents, whatever a crawler may have found them in.
          "/d/",
          // Auth screens are a dead end in search results.
          "/sign-in/",
          "/sign-up/",
        ],
      },
    ],
    sitemap: absoluteUrl("/sitemap.xml"),
    host: SITE_URL,
  };
}
