"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { brandSans } from "@/lib/brand-fonts";
import {
  CONSENT_COOKIE,
  CONSENT_MAX_AGE_SECONDS,
  COUNTRY_COOKIE,
  type ConsentChoice,
  consentUpdatePayload,
  shouldAskForConsent,
} from "@/lib/consent";
import styles from "./consent-banner.module.css";

/**
 * The consent banner, shown only where a choice is expected.
 *
 * It renders nothing at all until the effect has run, so the server HTML and
 * the first client render agree; the banner appearing a frame later is the
 * price of static pages that are identical for every visitor.
 *
 * The reopen path is the other half of this: a choice that cannot be withdrawn
 * as easily as it was given is not much of a choice, so the footer link
 * dispatches `mastline:consent-reopen` and the banner comes back.
 */

export const CONSENT_REOPEN_EVENT = "mastline:consent-reopen";

function readCookie(name: string): string | undefined {
  const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : undefined;
}

function writeConsentCookie(choice: ConsentChoice): void {
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${CONSENT_COOKIE}=${choice}; Path=/; Max-Age=${CONSENT_MAX_AGE_SECONDS}; SameSite=Lax${secure}`;
}

declare global {
  interface Window {
    dataLayer?: unknown[];
  }
}

/**
 * Reports the choice to the tag.
 *
 * gtag() is defined by the defaults script in the head, but pushing the same
 * shape straight onto dataLayer is equivalent and does not depend on a global
 * this module cannot see the type of.
 */
function reportChoice(choice: ConsentChoice): void {
  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push(["consent", "update", consentUpdatePayload(choice)]);
}

export function ConsentBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const decide = () => {
      const alreadyChosen = readCookie(CONSENT_COOKIE) !== undefined;
      setVisible(!alreadyChosen && shouldAskForConsent(readCookie(COUNTRY_COOKIE)));
    };

    decide();

    const reopen = () => setVisible(true);
    window.addEventListener(CONSENT_REOPEN_EVENT, reopen);
    return () => window.removeEventListener(CONSENT_REOPEN_EVENT, reopen);
  }, []);

  const choose = useCallback((choice: ConsentChoice) => {
    writeConsentCookie(choice);
    reportChoice(choice);
    setVisible(false);
  }, []);

  if (!visible) return null;

  return (
    <div
      className={`${styles.banner} ${brandSans.variable}`}
      role="dialog"
      aria-label="Cookies and measurement"
    >
      <p className={styles.copy}>
        Mastline uses Google Analytics to understand how the site is used. Nothing is stored on your
        device and no measurement is recorded until you accept. Read the{" "}
        <Link href="/privacy">privacy policy</Link>.
      </p>
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.button}
          onClick={() => choose("denied")}
          data-testid="consent-reject"
        >
          Refuse
        </button>
        <button
          type="button"
          className={`${styles.button} ${styles.accept}`}
          onClick={() => choose("granted")}
          data-testid="consent-accept"
        >
          Accept
        </button>
      </div>
    </div>
  );
}
