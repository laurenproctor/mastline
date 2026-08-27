"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { brandSans } from "@/lib/brand-fonts";
import {
  CONSENT_CATEGORIES,
  CONSENT_COOKIE,
  CONSENT_MAX_AGE_SECONDS,
  COUNTRY_COOKIE,
  type ConsentChoice,
  DEFAULT_CONSENT_PREFERENCES,
  type ConsentPreferences,
  consentUpdatePayload,
  preferencesToChoice,
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

/**
 * Fired the moment a choice is stored, so anything gated on consent can act on
 * it without waiting for a navigation. Reading the cookie on mount alone would
 * mean the visitor accepts, nothing happens, and the yes only takes effect on
 * the next page -- which reads as the button not working.
 */
export const CONSENT_CHANGED_EVENT = "mastline:consent-changed";

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

/**
 * The custom property the layout reserves space with.
 *
 * The banner is fixed to the bottom of the viewport and the application shell
 * anchors controls to the bottom of the viewport too, so without this they
 * occupy the same pixels and the banner wins: Sign out could not be clicked at
 * all while a choice was outstanding, which is every visitor in the EEA, the
 * UK, or Switzerland, and everyone whose country cannot be resolved.
 *
 * It is measured rather than assumed because the copy wraps to a different
 * number of lines at different widths, and a hard-coded height would be wrong
 * at some of them.
 */
export const CONSENT_INSET_PROPERTY = "--consent-inset";

export function ConsentBanner() {
  const [visible, setVisible] = useState(false);
  const [managing, setManaging] = useState(false);
  const [preferences, setPreferences] = useState<ConsentPreferences>(DEFAULT_CONSENT_PREFERENCES);
  const bannerRef = useRef<HTMLDivElement>(null);
  const panelHeadingRef = useRef<HTMLHeadingElement>(null);

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

  // Publish the banner's height for as long as it is up, and take it back down
  // the moment it goes. Kept in an effect rather than in the click handler so a
  // reopen, a resize, and a font swap all keep it honest.
  useEffect(() => {
    const root = document.documentElement;
    const element = bannerRef.current;

    if (!visible || !element) {
      root.style.removeProperty(CONSENT_INSET_PROPERTY);
      return;
    }

    const publish = () => {
      root.style.setProperty(
        CONSENT_INSET_PROPERTY,
        `${Math.ceil(element.getBoundingClientRect().height)}px`,
      );
    };

    publish();

    // ResizeObserver is not in every environment the tests run in, and a
    // missing one should cost the resize accuracy, not the whole inset.
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(publish) : undefined;
    observer?.observe(element);

    return () => {
      observer?.disconnect();
      root.style.removeProperty(CONSENT_INSET_PROPERTY);
    };
  }, [visible]);

  const choose = useCallback((choice: ConsentChoice) => {
    writeConsentCookie(choice);
    reportChoice(choice);
    window.dispatchEvent(new CustomEvent(CONSENT_CHANGED_EVENT, { detail: choice }));
    setManaging(false);
    setVisible(false);
  }, []);

  // Escape leaves the panel without deciding anything. It deliberately does not
  // close the banner: dismissing a consent request with a keystroke would
  // record no choice while looking like one was made.
  useEffect(() => {
    if (!managing) return;

    panelHeadingRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setManaging(false);
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [managing]);

  if (!visible) return null;

  if (managing) {
    return (
      <div
        className={`${styles.banner} ${styles.panel} ${brandSans.variable}`}
        ref={bannerRef}
        role="dialog"
        aria-label="Cookies and measurement"
      >
        <div className={styles.panelBody}>
          <h2 className={styles.panelHeading} tabIndex={-1} ref={panelHeadingRef}>
            Choose what to allow
          </h2>

          <ul className={styles.categories}>
            {CONSENT_CATEGORIES.map((category) => (
              <li key={category.id} className={styles.category}>
                <div className={styles.categoryHead}>
                  {category.optional ? (
                    <label className={styles.switch}>
                      <input
                        type="checkbox"
                        checked={preferences.analytics}
                        onChange={(event) =>
                          setPreferences({ analytics: event.currentTarget.checked })
                        }
                        data-testid={`consent-toggle-${category.id}`}
                      />
                      <span className={styles.categoryLabel}>{category.label}</span>
                    </label>
                  ) : (
                    <>
                      <span className={styles.categoryLabel}>{category.label}</span>
                      {/* Stated, not offered. A switch that cannot move is a
                          worse answer than saying so in words. */}
                      <span className={styles.always}>Always on</span>
                    </>
                  )}
                </div>
                <p className={styles.categoryCopy}>{category.description}</p>
              </li>
            ))}
          </ul>

          <p className={styles.footnote}>
            Mastline&rsquo;s hosting provider also counts page views without storing anything on
            your device or collecting an identifier, so there is nothing here to switch off. The{" "}
            <Link href="/privacy">privacy policy</Link> says what it records.
          </p>
        </div>

        <div className={styles.actions}>
          <button type="button" className={styles.button} onClick={() => setManaging(false)}>
            Back
          </button>
          <button
            type="button"
            className={`${styles.button} ${styles.accept}`}
            onClick={() => choose(preferencesToChoice(preferences))}
            data-testid="consent-save"
          >
            Save choices
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`${styles.banner} ${brandSans.variable}`}
      ref={bannerRef}
      role="dialog"
      aria-label="Cookies and measurement"
    >
      <p className={styles.copy}>
        We use essential cookies to make this site work. With your permission, we also use analytics
        cookies to understand how people use the site and improve it. You can accept, reject, or
        manage these optional cookies. Read the <Link href="/privacy">privacy policy</Link>.
      </p>
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.button}
          onClick={() => setManaging(true)}
          data-testid="consent-manage"
        >
          Manage
        </button>
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
