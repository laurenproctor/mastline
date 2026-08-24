import type { Metadata } from "next";
import { brandSans, brandSerif } from "@/lib/brand-fonts";
import Image from "next/image";
import Link from "next/link";
import { SiteNav } from "./_components/site-nav";
import "./marketing.css";

/**
 * The public marketing site.
 *
 * Its own layout, and its own stylesheet, because it is a different design
 * language from the signed-in application. marketing.css reaches only this
 * layout and the sign-up screen the site hands over to, never the operating
 * screens, which keep their own language in globals.css.
 *
 * Nothing under this layout reads the database. That is deliberate: the front
 * door should stay up when the environment is misconfigured or Supabase is
 * unreachable, which is also why middleware serves these paths before it builds
 * a Supabase client.
 */

export const metadata: Metadata = {
  title: { default: "Mastline", template: "%s — Mastline" },
  description:
    "From assignment to payment, keep every shoot, image, submission, and dollar in one place.",
};

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`mkt ${brandSans.variable} ${brandSerif.variable}`}>
      <a className="skip" href="#main">
        Skip to main content
      </a>
      <SiteNav />
      <main id="main">{children}</main>
      <footer>
        <div className="wrap">
          <div className="top">
            <div>
              <div className="logo">
                <Image
                  src="/marketing/wordmark-reversed.png"
                  alt="Mastline"
                  width={800}
                  height={137}
                />
              </div>
              <p className="tag">
                The business operating system for paparazzi, independent celebrity photographers,
                and boutique photo agencies.
              </p>
            </div>
            <div>
              <h4>Explore</h4>
              <ul>
                <li>
                  <Link href="/product">Product</Link>
                </li>
                <li>
                  <Link href="/commercial">Commercial opportunities</Link>
                </li>
                <li>
                  <Link href="/teams">Teams &amp; agencies</Link>
                </li>
                <li>
                  <Link href="/editors">For editors</Link>
                </li>
                <li>
                  <Link href="/how-it-works">How it works</Link>
                </li>
                <li>
                  <Link href="/pricing">Pricing</Link>
                </li>
                <li>
                  <Link href="/trust">Trust</Link>
                </li>
              </ul>
            </div>
            <div>
              <h4>Company</h4>
              <ul>
                <li>
                  <Link href="/company">Company</Link>
                </li>
                <li>
                  <Link href="/press">Press</Link>
                </li>
                <li>
                  <Link href="/subjects">If you appear in a photo</Link>
                </li>
                <li>
                  <Link href="/signup">Start free</Link>
                </li>
                <li>
                  <a href="mailto:hello@mastline.co">Contact</a>
                </li>
                <li>
                  <a href="[HELP CENTER URL]">Help center</a>
                </li>
                <li>
                  <a href="[STATUS PAGE URL]">Status</a>
                </li>
              </ul>
            </div>
            <div>
              <h4>Legal</h4>
              <ul>
                <li>
                  <Link href="/privacy">Privacy</Link>
                </li>
                <li>
                  <Link href="/terms">Terms</Link>
                </li>
                <li>
                  <Link href="/acceptable-use">Acceptable use</Link>
                </li>
                <li>
                  <Link href="/copyright">Copyright</Link>
                </li>
                <li>
                  <Link href="/security">Security</Link>
                </li>
                <li>
                  <Link href="/accessibility">Accessibility</Link>
                </li>
              </ul>
            </div>
          </div>
          <div className="bottom">
            <span>© 2026 Mastline. All rights reserved.</span>
            <span>
              Made with{" "}
              <svg
                aria-label="love"
                role="img"
                viewBox="0 0 24 24"
                style={{ width: "14px", height: "14px", verticalAlign: "-2px", fill: "#89FF0A" }}
              >
                <path d="M12 21s-7.2-4.6-9.6-9A5.4 5.4 0 0 1 12 6.2 5.4 5.4 0 0 1 21.6 12c-2.4 4.4-9.6 9-9.6 9z" />
              </svg>{" "}
              in New York City
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}
