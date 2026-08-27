"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePrefersReducedMotion } from "./use-reduced-motion";

/**
 * What is inside the frame, found and then sorted.
 *
 * The Commercial Opportunities page argues that a picture carries a second
 * market -- the jacket, the sneakers, the bag -- and that every item is
 * labelled by how certain the match is, because matching is assisted rather
 * than magic. That is a hard argument to make in prose and an easy one to
 * show: four pins land on a frame, each carrying its own confidence, and the
 * two routes open or stay shut depending on what the label and the rights
 * analysis actually allow.
 *
 * The frame is drawn rather than photographed, for the same reason the home
 * page's archive grid is: a real screenshot would need real pins at real
 * coordinates, and the demonstration would break the first time the picture
 * was replaced.
 *
 * Brands are bracketed placeholders, the convention the rest of the site
 * already uses for names it is not ready to print.
 */

type MatchClass = "exact" | "probable" | "alt" | "similar";

interface Detection {
  item: string;
  /** Where the pin sits on the frame, as percentages. */
  x: number;
  y: number;
  match: MatchClass;
  label: string;
  /** Route A: licensing the frame to a brand. */
  brand: string;
  /** Route B: the shoppable package. */
  shoppable: string;
  /** What the rights analysis says before either route is offered. */
  rights: string;
}

const DETECTIONS: readonly Detection[] = [
  {
    item: "[Brand] leather jacket",
    x: 47,
    y: 40,
    match: "exact",
    label: "Exact match",
    brand: "Pitchable · suggested band $600–900",
    shoppable: "Direct affiliate link to the product page",
    rights: "Editorial use cleared. A brand pitch needs a release — Mastline says so first.",
  },
  {
    item: "[Brand] runner, white",
    x: 44,
    y: 86,
    match: "probable",
    label: "Probable match",
    brand: "Held back until someone confirms it",
    shoppable: "Linked, and shown to readers as likely",
    rights: "Editorial use cleared.",
  },
  {
    item: "[Brand] tote, last season",
    x: 64,
    y: 56,
    match: "alt",
    label: "Same-brand alternative",
    brand: "Pitchable · the brand’s current equivalent",
    shoppable: "The nearest in-stock piece, labelled an alternative",
    rights: "Editorial use cleared.",
  },
  {
    item: "Sunglasses, brand unread",
    x: 50,
    y: 17,
    match: "similar",
    label: "Similar style",
    brand: "No brand identified — nothing to pitch",
    shoppable: "Comparable items from partner retailers, marked similar",
    rights: "Editorial use cleared.",
  },
];

/** Gap between one pin landing and the next. */
const PIN_MS = 620;

export function DetectionDemo() {
  const reduced = usePrefersReducedMotion();
  const root = useRef<HTMLDivElement>(null);

  const [landed, setLanded] = useState(0);
  const [selected, setSelected] = useState(0);
  const [scanning, setScanning] = useState(false);

  // A reader who asked for less motion has everything from the first paint:
  // there is no scan to watch and nothing to wait for. Derived rather than
  // written into state, so no render is spent catching up to the preference.
  const found = reduced ? DETECTIONS.length : landed;

  const play = useCallback(() => {
    setLanded(0);
    setSelected(0);
    setScanning(true);
  }, []);

  useEffect(() => {
    const el = root.current;
    if (!el || reduced) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          play();
          observer.disconnect();
        }
      },
      { threshold: 0.35 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [reduced, play]);

  // The pins land one after another once the sweep has passed.
  useEffect(() => {
    if (!scanning || reduced || landed >= DETECTIONS.length) return;
    const timer = setTimeout(() => setLanded((n) => n + 1), landed === 0 ? 900 : PIN_MS);
    return () => clearTimeout(timer);
  }, [scanning, reduced, landed]);

  const current = DETECTIONS[selected];
  const revealed = (index: number) => index < found;

  return (
    <div className="detect" ref={root}>
      <div className="detect-frame">
        <div
          className={`detect-image${scanning && !reduced ? " scanning" : ""}`}
          aria-hidden="true"
        >
          <span className="detect-sweep" />
          {DETECTIONS.map((entry, index) => (
            <span
              className={`detect-pin${revealed(index) ? " in" : ""}${index === selected ? " on" : ""}`}
              key={entry.item}
              style={{ left: `${entry.x}%`, top: `${entry.y}%` }}
            >
              <i />
            </span>
          ))}
        </div>
        <div className="detect-caption">
          <span>Set 0419 · frame 07</span>
          <span>
            {found} of {DETECTIONS.length} items detected
          </span>
        </div>
      </div>

      <div className="detect-side">
        <ul className="detect-list">
          {DETECTIONS.map((entry, index) => (
            <li className={revealed(index) ? "in" : ""} key={entry.item}>
              <button
                aria-pressed={index === selected}
                className={index === selected ? "on" : ""}
                onClick={() => setSelected(index)}
                type="button"
              >
                <span className={`chip ${entry.match}`}>{entry.label}</span>
                <b>{entry.item}</b>
              </button>
            </li>
          ))}
        </ul>

        <div aria-live="polite" className="detect-routes">
          <div key={current.item}>
            <div className="detect-route">
              <span className="mk-eyebrow">Route A · Brand licensing</span>
              <p>{current.brand}</p>
            </div>
            <div className="detect-route">
              <span className="mk-eyebrow">Route B · Shoppable</span>
              <p>{current.shoppable}</p>
            </div>
            <p className="detect-rights">
              <b>Rights</b> {current.rights}
            </p>
          </div>
        </div>

        {!reduced && (
          <button className="pitch-replay" onClick={play} type="button">
            Replay the scan
          </button>
        )}
      </div>
    </div>
  );
}
