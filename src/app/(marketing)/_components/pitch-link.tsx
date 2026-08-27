"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePrefersReducedMotion } from "./use-reduced-motion";

/**
 * The pitch link, played through.
 *
 * The claim on the editors page and on the product page is that a picture desk
 * does not adopt anything: it opens a link, looks, and taps. That claim was
 * being made in four static paragraphs, which is the one place on the site
 * where showing costs less than telling. So the four steps became a rail, and
 * beside it is the thing the editor actually sees.
 *
 * The pages keep their own words. The copy in `.edsteps` differed between
 * editors and product, and both readings are right for their page, so the
 * steps arrive as a prop rather than being written in here.
 *
 * It plays itself when scrolled to, and stops the moment the reader takes over
 * -- clicking a step, or accepting the license -- because an autoplaying panel
 * that keeps moving under a hand on the controls is infuriating. Replay puts
 * it back to the start, the same affordance the archive demo on the home page
 * offers.
 */

export interface PitchStep {
  /** The rail's heading for this step. */
  title: string;
  /** The rail's sentence. Kept per page, because the two pages say it differently. */
  body: string;
}

/** How long each screen holds before the demonstration moves itself on. */
const DWELL_MS = [2600, 4200, 3800, 0];

/** The exclusive window, counted down for real while the set is on screen. */
const WINDOW_SECONDS = 44 * 60 + 12;

const two = (n: number) => String(n).padStart(2, "0");

function clock(seconds: number): string {
  const safe = Math.max(0, seconds);
  return `${two(Math.floor(safe / 3600))}:${two(Math.floor(safe / 60) % 60)}:${two(safe % 60)}`;
}

const FRAMES = ["t1", "t2", "t3", "t4"] as const;

const FILES = ["MSTL_0419_007.jpg", "MSTL_0419_011.jpg", "MSTL_0419_014.jpg", "license-0419.pdf"];

export function PitchLink({ steps }: { steps: readonly PitchStep[] }) {
  const reduced = usePrefersReducedMotion();
  const root = useRef<HTMLDivElement>(null);

  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  /** Set once the reader touches anything, and never unset until Replay. */
  const [driven, setDriven] = useState(false);
  const [remaining, setRemaining] = useState(WINDOW_SECONDS);

  const goTo = useCallback((next: number) => {
    setStep(next);
    setDriven(true);
    setPlaying(false);
  }, []);

  const replay = useCallback(() => {
    setStep(0);
    setDriven(false);
    setRemaining(WINDOW_SECONDS);
    setPlaying(true);
  }, []);

  // Start when it is looked at. Unlike the home page's archive demo this does
  // not rearm on the way out: the last screen is the point being made, and
  // resetting it to an empty phone every time the section leaves the viewport
  // would mean a reader who scrolls back sees nothing.
  useEffect(() => {
    const el = root.current;
    if (!el || reduced) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          setPlaying((was) => was || !driven);
          observer.disconnect();
        }
      },
      { threshold: 0.3 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [reduced, driven]);

  // Advance while it is playing itself.
  useEffect(() => {
    if (!playing || driven || reduced) return;
    const dwell = DWELL_MS[step];
    if (!dwell) return;
    const timer = setTimeout(() => setStep((s) => Math.min(s + 1, steps.length - 1)), dwell);
    return () => clearTimeout(timer);
  }, [playing, driven, reduced, step, steps.length]);

  // The exclusive runs down for real while the desk is looking at the set and
  // deciding. It stops once the license is accepted, because at that point the
  // window is no longer the thing under pressure.
  useEffect(() => {
    if (reduced || step === 0 || step >= 3) return;
    const tick = setInterval(() => setRemaining((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(tick);
  }, [reduced, step]);

  const accepted = step >= 3;

  return (
    <div className="pitch" ref={root}>
      <ol className="pitch-rail">
        {steps.map((entry, index) => (
          <li className={index === step ? "on" : index < step ? "done" : ""} key={entry.title}>
            <button
              aria-current={index === step ? "step" : undefined}
              onClick={() => goTo(index)}
              type="button"
            >
              <i aria-hidden="true">{index + 1}</i>
              <span>
                <b>{entry.title}</b>
                <small>{entry.body}</small>
              </span>
            </button>
          </li>
        ))}
      </ol>

      <div className="pitch-device">
        {/* One live region, so a screen reader following along is told what
            changed rather than having to hunt for it. */}
        <div className="pitch-screen" aria-live="polite" data-step={step}>
          <div className="pitch-bar">
            <span className="pitch-host">mastline.co/p/0419</span>
            {step > 0 && !accepted && (
              <span className="pitch-timer">
                Exclusive <b>{clock(remaining)}</b>
              </span>
            )}
            {accepted && <span className="pitch-timer done">Licensed</span>}
          </div>

          {step === 0 && (
            <div className="pitch-pane pitch-message">
              <span className="pitch-from">Message · 11:14 PM</span>
              <p className="pitch-bubble">
                Two subjects at the valet, Sunset Tower, 20 minutes ago. 22 frames, first refusal
                for 45 minutes.
                <em>mastline.co/p/0419</em>
              </p>
              <span className="pitch-note">No account. No app. It opens in any browser.</span>
            </div>
          )}

          {step === 1 && (
            <div className="pitch-pane">
              <div className="pitch-frames">
                {FRAMES.map((tone, index) => (
                  <div
                    className={`pitch-frame ${tone}`}
                    key={tone}
                    style={{ "--i": index } as React.CSSProperties}
                  >
                    <span aria-hidden="true">PREVIEW</span>
                  </div>
                ))}
              </div>
              <p className="pitch-caption">
                [Subject] and [Subject] leave Sunset Tower, West Hollywood, tonight.
              </p>
              <dl className="pitch-terms">
                <div>
                  <dt>Asking</dt>
                  <dd>$1,500</dd>
                </div>
                <div>
                  <dt>Use</dt>
                  <dd>All media · worldwide · 30 days</dd>
                </div>
                <div>
                  <dt>Credit</dt>
                  <dd>Set by the photographer</dd>
                </div>
              </dl>
            </div>
          )}

          {step === 2 && (
            <div className="pitch-pane">
              <p className="pitch-ask">
                <span>Accept at asking</span>
                <b>$1,500</b>
              </p>
              <button className="pitch-accept" onClick={() => goTo(3)} type="button">
                Accept the license
              </button>
              <span className="pitch-or">or counter</span>
              <ul className="pitch-counters">
                <li>
                  <button onClick={() => goTo(3)} type="button">
                    <b>$1,200</b>
                    <small>Web only · 7 days</small>
                  </button>
                </li>
                <li>
                  <button onClick={() => goTo(3)} type="button">
                    <b>$1,800</b>
                    <small>All media · 48h exclusive</small>
                  </button>
                </li>
              </ul>
              <span className="pitch-note">
                The photographer answers from their phone. No login either side.
              </span>
            </div>
          )}

          {step === 3 && (
            <div className="pitch-pane">
              <p className="pitch-done">
                <svg
                  aria-hidden="true"
                  fill="none"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2.4"
                  viewBox="0 0 24 24"
                >
                  <path d="M5 12l4 4L19 6" />
                </svg>
                License issued · full resolution unlocked
              </p>
              <ul className="pitch-files">
                {FILES.map((file, index) => (
                  <li key={file} style={{ "--i": index } as React.CSSProperties}>
                    <span>{file}</span>
                    <i aria-hidden="true" />
                  </li>
                ))}
              </ul>
              <dl className="pitch-terms">
                <div>
                  <dt>Licensed</dt>
                  <dd>$1,800 · all media · 48h exclusive</dd>
                </div>
                <div>
                  <dt>Invoice</dt>
                  <dd>Sent in the outlet’s format</dd>
                </div>
              </dl>
              <span className="pitch-note">Every open and download is logged on the record.</span>
            </div>
          )}
        </div>

        <button className="pitch-replay" onClick={replay} type="button">
          Replay
        </button>
      </div>
    </div>
  );
}
