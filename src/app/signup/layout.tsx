import Image from "next/image";
import Link from "next/link";
import { brandSans, brandSerif } from "@/lib/brand-fonts";
import "@/app/(marketing)/marketing.css";
import "./signup.css";

/**
 * The handover.
 *
 * Every "Start free" on the public site points here, so this screen is the last
 * page of the marketing site rather than the first page of the application: it
 * borrows the editorial direction, not the operating language, and a visitor
 * never falls off a design cliff between clicking the button and filling in the
 * form.
 *
 * The chrome is deliberately thinner than the site's. There is one way back to
 * the front page and one way to sign in, and no navigation to wander off into
 * from a screen whose entire job is the form.
 */
export default function SignUpLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`mkt su-shell ${brandSans.variable} ${brandSerif.variable}`}>
      <a className="skip" href="#main">
        Skip to the form
      </a>
      <header className="su-head">
        <Link aria-label="Mastline home" className="su-logo" href="/">
          <Image alt="Mastline" height={137} priority src="/marketing/wordmark.png" width={800} />
        </Link>
        <p className="su-alt">
          <span>Already have an account?</span> <Link href="/login">Sign in</Link>
        </p>
      </header>
      {children}
    </div>
  );
}
