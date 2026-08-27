"use client";

import { useEffect, useState } from "react";
import { CONSENT_COOKIE, type ConsentChoice } from "@/lib/consent";
import { CONSENT_CHANGED_EVENT } from "./consent-banner";

/**
 * Microsoft Clarity, loaded only once the visitor has said yes.
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

function storedChoice(): ConsentChoice | undefined {
  const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${CONSENT_COOKIE}=(granted|denied)`));
  return match ? (match[1] as ConsentChoice) : undefined;
}

export function Clarity() {
  const [granted, setGranted] = useState(false);

  useEffect(() => {
    const read = () => setGranted(storedChoice() === "granted");

    read();
    window.addEventListener(CONSENT_CHANGED_EVENT, read);
    return () => window.removeEventListener(CONSENT_CHANGED_EVENT, read);
  }, []);

  useEffect(() => {
    if (!granted) return;
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
  }, [granted]);

  return null;
}
