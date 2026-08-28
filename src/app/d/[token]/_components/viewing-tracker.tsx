"use client";

import { useEffect } from "react";
import {
  VISIBLE_RATIO,
  countableTickMs,
  isActivelyViewing,
  isMeaningfullyVisible,
} from "@/lib/viewing-time";

/**
 * How long the desk actually looked, measured honestly.
 *
 * The whole difficulty here is that "the page was open" and "somebody was
 * looking at it" are very different claims, and the easy implementation --
 * start a timer on mount, stop it on unmount -- reports the first while
 * appearing to report the second. A tab left open over a weekend would say the
 * New York picture desk studied the package for sixty hours.
 *
 * So time accrues only while all four of these hold:
 *
 *   the document is visible          (Page Visibility, so a background tab is
 *                                     not viewing)
 *   the window has focus             (a visible but unfocused window behind
 *                                     another one is not viewing either)
 *   there has been recent activity   (no pointer, key, scroll, or touch for two
 *                                     minutes is somebody who walked away)
 *   the frame is meaningfully in view (half of it on screen, not one pixel)
 *
 * and the accrual is bounded by the wall clock between ticks, so a throttled
 * timer that fires late cannot bank the gap.
 *
 * None of this is trusted. Every number here is a proposal; the server clamps
 * it against its own clock, a per-beat ceiling, and a monotonic sequence, and
 * returns what it actually counted. This is the polite half of the arrangement,
 * not the enforcing half.
 *
 * What is deliberately NOT collected: pointer positions, movement paths,
 * keystrokes, the name typed into the acceptance, scroll depth, clipboard
 * contents, or anything at all about the visitor's device beyond the user agent
 * the request already carried. There is no session replay here and no
 * fingerprinting: the visitor id is a random value this browser generated for
 * this link, and the server hashes the link into it so the same browser opening
 * two links is two unrelated visitors.
 */

/** Beat every ten seconds. Frequent enough to be accurate, rare enough to be quiet. */
const BEAT_MS = 10_000;
/** How often the accrual loop runs. Finer than the beat so partial time is not lost. */
const TICK_MS = 1_000;

/*
 * The conditions themselves live in `@/lib/viewing-time`, where they can be
 * argued with directly. They are the part worth testing and the part a browser
 * makes awkward to test: the idle threshold is two minutes, which is too long
 * to sit through in a browser test and trivial to assert against a function.
 */

function randomHandle(): string {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * A handle that survives a reload, scoped to this link.
 *
 * Storage can throw outright -- Safari in private mode, a browser set to block
 * site data -- and a delivery page must not white-screen because a picture
 * editor has strict settings. Every read and write is guarded, and a failure
 * degrades to a per-page-load handle, which measures this visit correctly and
 * simply cannot recognise the next one.
 */
function handleFor(storage: "local" | "session", key: string): string {
  try {
    const store = storage === "local" ? window.localStorage : window.sessionStorage;
    const existing = store.getItem(key);
    if (existing && /^[A-Za-z0-9_-]{16,64}$/.test(existing)) return existing;
    const fresh = randomHandle();
    store.setItem(key, fresh);
    return fresh;
  } catch {
    return randomHandle();
  }
}

export function ViewingTracker({ token }: { token: string }) {
  useEffect(() => {
    // Scoped to the link on both sides: the storage key includes the token, and
    // the server hashes the delivery id into whatever arrives.
    const scope = token.slice(0, 16);
    const visitor = handleFor("local", `ml.d.v.${scope}`);
    const session = handleFor("session", `ml.d.s.${scope}`);

    const endpoint = `/d/${token}/activity`;
    let sequence = 0;
    let pendingMs = 0;
    const pendingAssets = new Map<string, { visibleMs: number; viewStarted: boolean }>();
    const visibleAssets = new Set<string>();
    let lastActivity = Date.now();
    let lastTick = Date.now();
    let stopped = false;

    const noteActivity = () => {
      lastActivity = Date.now();
    };

    const isViewing = () =>
      isActivelyViewing({
        documentVisible: document.visibilityState === "visible",
        windowFocused: document.hasFocus(),
        msSinceActivity: Date.now() - lastActivity,
      });

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const assetId = (entry.target as HTMLElement).dataset.assetId;
          if (!assetId) continue;

          if (entry.isIntersecting && isMeaningfullyVisible(entry.intersectionRatio)) {
            if (!visibleAssets.has(assetId)) {
              visibleAssets.add(assetId);
              // A frame scrolled back to is a second view of it.
              const current = pendingAssets.get(assetId) ?? { visibleMs: 0, viewStarted: false };
              pendingAssets.set(assetId, { ...current, viewStarted: true });
            }
          } else {
            // Out of view: timing stops here rather than at the next beat.
            visibleAssets.delete(assetId);
          }
        }
      },
      { threshold: [0, VISIBLE_RATIO, 1] },
    );

    for (const node of document.querySelectorAll<HTMLElement>("[data-asset-id]")) {
      observer.observe(node);
    }

    const tick = () => {
      const now = Date.now();
      // Bounded by the wall clock, so a timer throttled in a background tab
      // wakes up owing itself one tick rather than the whole interval.
      const elapsed = countableTickMs(now - lastTick);
      lastTick = now;

      if (!isViewing()) return;

      pendingMs += elapsed;
      for (const assetId of visibleAssets) {
        const current = pendingAssets.get(assetId) ?? { visibleMs: 0, viewStarted: false };
        pendingAssets.set(assetId, { ...current, visibleMs: current.visibleMs + elapsed });
      }
    };

    const beat = (final: boolean) => {
      if (stopped) return;
      // Nothing to say. A beat carrying no time is a request for its own sake.
      if (pendingMs === 0 && pendingAssets.size === 0) return;

      sequence += 1;
      const payload = JSON.stringify({
        visitor,
        session,
        sequence,
        visibleMs: pendingMs,
        assets: [...pendingAssets.entries()].map(([assetId, value]) => ({
          assetId,
          visibleMs: value.visibleMs,
          viewStarted: value.viewStarted,
        })),
      });

      pendingMs = 0;
      pendingAssets.clear();

      if (final && navigator.sendBeacon) {
        navigator.sendBeacon(endpoint, new Blob([payload], { type: "application/json" }));
        return;
      }

      void fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
        keepalive: final,
      }).catch(() => {
        // A dropped beat costs a few seconds of measurement. It must never
        // surface to the recipient, who is here to look at photographs.
      });
    };

    const onHidden = () => {
      // Bank what was accrued before the tab went away, then stop counting.
      tick();
      beat(true);
    };

    const onPageHide = () => {
      stopped = true;
      tick();
      beat(true);
      if (navigator.sendBeacon) {
        navigator.sendBeacon(
          endpoint,
          new Blob([JSON.stringify({ kind: "end", visitor, session })], {
            type: "application/json",
          }),
        );
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        onHidden();
      } else {
        // Coming back does not credit the time spent away.
        lastTick = Date.now();
        noteActivity();
      }
    };

    const ticker = window.setInterval(tick, TICK_MS);
    const beater = window.setInterval(() => beat(false), BEAT_MS);

    const activityEvents = ["pointerdown", "keydown", "scroll", "touchstart", "pointermove"];
    for (const name of activityEvents) {
      window.addEventListener(name, noteActivity, { passive: true });
    }
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("blur", onHidden);
    window.addEventListener("focus", () => {
      lastTick = Date.now();
      noteActivity();
    });

    return () => {
      stopped = true;
      window.clearInterval(ticker);
      window.clearInterval(beater);
      observer.disconnect();
      for (const name of activityEvents) window.removeEventListener(name, noteActivity);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("blur", onHidden);
    };
  }, [token]);

  return null;
}
