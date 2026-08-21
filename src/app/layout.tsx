import type { Metadata } from "next";
import { AnimatedFavicon } from "@/components/animated-favicon";
import "./globals.css";

export const metadata: Metadata = {
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
      <body>
        <AnimatedFavicon />
        {children}
      </body>
    </html>
  );
}
