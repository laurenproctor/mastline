import type { MetadataRoute } from "next";
import { PROTECTED_ROUTES, WORKSPACE_SECTIONS } from "@/lib/routes";
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
          // The same areas again, one segment in, because every workspace
          // sits under an address of its own now. robots.txt is a request
          // rather than a control, so the gated layouts also carry noindex.
          ...WORKSPACE_SECTIONS.map((section) => `/*/${section}/`),
          // Tokenised delivery links are held by picture desks and are not
          // public documents, whatever a crawler may have found them in.
          "/d/",
          // And request-intake links, which are narrower still: one buyer, one
          // request, and a token that stops working the moment it is used.
          "/r/",
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
