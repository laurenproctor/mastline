import type { Metadata } from "next";
import { AnimatedFavicon } from "@/components/animated-favicon";
import { ConsentBanner } from "@/components/consent-banner";
import { consentDefaultsScript } from "@/lib/consent";
import { SITE_URL } from "@/lib/site";
import "./globals.css";

const GTM_ID = "GTM-5V6WVX4R";

export const metadata: Metadata = {
  // Without this, Next emits relative Open Graph and canonical URLs and warns
  // at build. It is also what the sitemap and robots.txt resolve against.
  metadataBase: new URL(SITE_URL),
  // No Search Console verification tag: the property is verified by a DNS TXT
  // record instead, which keeps the token out of the environment and holds
  // across a hosting change. Do not add the meta tag back.
  title: "Mastline — Paparazzi Business OS",
  description:
    "From assignment to payment, keep every shoot, image, submission, and dollar in one place.",
  // The SVG is the icon nearly every current browser uses, and the one
  // AnimatedFavicon blinks. The PNGs are the fallback for what cannot decode
  // it, and for a home-screen bookmark.
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/favicon-96.png", type: "image/png", sizes: "96x96" },
    ],
    apple: { url: "/apple-touch-icon.png", sizes: "180x180" },
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <head>
        {/*
          Consent Mode defaults, which must be the first script in the head.
          The container reads the consent state as it initialises, so declaring
          the defaults after it would let the first hit be decided on the wrong
          basis -- the one ordering mistake this whole mechanism turns on.
        */}
        <script dangerouslySetInnerHTML={{ __html: consentDefaultsScript() }} />
        {/* Google Tag Manager */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
})(window,document,'script','dataLayer','${GTM_ID}');`,
          }}
        />
        {/* End Google Tag Manager */}
      </head>
      <body>
        {/* Google Tag Manager (noscript) */}
        <noscript>
          <iframe
            src={`https://www.googletagmanager.com/ns.html?id=${GTM_ID}`}
            height="0"
            width="0"
            style={{ display: "none", visibility: "hidden" }}
          />
        </noscript>
        {/* End Google Tag Manager (noscript) */}
        <AnimatedFavicon />
        {children}
        <ConsentBanner />
      </body>
    </html>
  );
}
