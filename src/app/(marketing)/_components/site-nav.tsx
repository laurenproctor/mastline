"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

/**
 * The marketing header.
 *
 * A client component for two reasons only: the menu opens on a phone, and the
 * current section is marked. Everything else on these pages is server-rendered.
 *
 * The artifact drove both from script against `data-nav` attributes and a
 * `.page.on` class. Here the pathname is the source of truth, so a link is
 * marked current whether you arrived by clicking or by typing the address.
 */
const LINKS = [
  { href: "/product", label: "Product" },
  { href: "/how-it-works", label: "How it works" },
  { href: "/pricing", label: "Pricing" },
  { href: "/trust", label: "Trust" },
] as const;

export function SiteNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // A menu left open across a navigation would cover the page you asked for.
  // Closing on the click that navigates avoids a state sync in an effect.
  const close = () => setOpen(false);

  const isCurrent = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <header className={`nav${open ? " open" : ""}`}>
      <div className="wrap">
        <Link aria-label="Mastline home" className="logo" href="/">
          <Image alt="Mastline" src="/marketing/wordmark.png" width={800} height={137} />
        </Link>
        <ul>
          {LINKS.map((link) => (
            <li key={link.href}>
              <Link
                aria-current={isCurrent(link.href) ? "page" : undefined}
                className={isCurrent(link.href) ? "on" : ""}
                href={link.href}
                onClick={close}
              >
                {link.label}
              </Link>
            </li>
          ))}
        </ul>
        <div className="cta">
          <Link className="btn ghost" href="/login">
            Sign in
          </Link>
          <Link className="btn primary" href="/early-access">
            Start free
          </Link>
        </div>
        <button
          aria-controls="mobilemenu"
          aria-expanded={open}
          aria-label={open ? "Close menu" : "Open menu"}
          className="burger"
          onClick={() => setOpen((wasOpen) => !wasOpen)}
          type="button"
        >
          <svg className="bars" viewBox="0 0 24 24">
            <path d="M4 7h16M4 12h16M4 17h16" />
          </svg>
          <svg className="x" viewBox="0 0 24 24">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
      <nav aria-label="Mobile" className="mobilemenu" id="mobilemenu">
        <ul>
          {LINKS.map((link) => (
            <li key={link.href}>
              <Link
                aria-current={isCurrent(link.href) ? "page" : undefined}
                className={isCurrent(link.href) ? "on" : ""}
                href={link.href}
                onClick={close}
              >
                {link.label}
              </Link>
            </li>
          ))}
        </ul>
        <div className="mactions">
          <Link className="btn ghost" href="/login">
            Sign in
          </Link>
          <Link className="btn primary" href="/early-access">
            Start free
          </Link>
        </div>
      </nav>
    </header>
  );
}
