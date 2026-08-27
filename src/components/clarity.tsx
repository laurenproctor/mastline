"use client";

import { useEffect, useState } from "react";
import {
  CONSENT_COOKIE,
  COUNTRY_COOKIE,
  type ConsentChoice,
  shouldAskForConsent,
} from "@/lib/consent";
import { CONSENT_CHANGED_EVENT } from "./consent-banner";

/**
 * Microsoft Clarity, loaded where measuring this visitor is allowed.
 *
 * It is loaded here rather than from the Google Tag Manager container because
 * the container fired it on `gtm.js` with no consent settings on the tag, which
 * meant it ran on every page load whatever the visitor chose: a request from
 * France that pressed Refuse still loaded Clarity and still had `_clck`,
 * `_clsk`, and Microsoft's own `MUID`, `CLID`, `ANONCHK`, `MR`, `SM`, and
 * `SRM_B` written to it. GA4 respects Consent Mode natively; a custom template
 * only respects it if someone configures that, and nobody had.
 *
 * In the application the gate is a condition rather than a setting, so it is
 * version-controlled, reviewable, and covered by a test that fails loudly.
 *
 * THIS ONLY HOLDS WHILE THE CONTAINER'S OWN CLARITY TAG IS GONE. Leave both in
 * place and the ungated one wins, because it does not ask.
 */

export const CLARITY_PROJECT_ID = "y835px9g5t";

function readCookie(name: string): string | undefined {
  const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : undefined;
}

function storedChoice(): ConsentChoice | undefined {
  const value = readCookie(CONSENT_COOKIE);
  return value === "granted" || value === "denied" ? value : undefined;
}

/**
 * The same shape as Consent Mode's own default, so the two collectors behave
 * alike rather than each having its own idea of who gets measured.
 *
 * A stored answer decides it. Without one, it comes down to whether this
 * visitor is owed the question: where a choice is required Clarity waits for it,
 * and where none is required it runs, exactly as the tag's defaults let Google
 * Analytics run. Gating on `granted` alone looked stricter and was really just
 * wrong -- outside the regulated regions no banner ever appears, so nobody ever
 * grants, so Clarity would never have run for them again.
 *
 * Refusing still stops it everywhere, because the banner can be reopened from
 * the footer wherever you are.
 */
function shouldRunClarity(): boolean {
  const choice = storedChoice();
  if (choice) return choice === "granted";
  return !shouldAskForConsent(readCookie(COUNTRY_COOKIE));
}

export function Clarity() {
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    const read = () => setAllowed(shouldRunClarity());

    read();
    window.addEventListener(CONSENT_CHANGED_EVENT, read);
    return () => window.removeEventListener(CONSENT_CHANGED_EVENT, read);
  }, []);

  useEffect(() => {
    if (!allowed) return;
    if (document.getElementById("ms-clarity")) return;

    const script = document.createElement("script");
    script.id = "ms-clarity";
    script.async = true;
    script.src = `https://www.clarity.ms/tag/${CLARITY_PROJECT_ID}`;
    document.head.appendChild(script);

    // Deliberately not removed on withdrawal: unloading a third-party script
    // does not un-run it, and pretending otherwise would be the same kind of
    // claim this component exists to stop making. Withdrawal stops the next
    // page load, and the banner's own copy says the choice can be changed.
  }, [allowed]);

  return null;
}
