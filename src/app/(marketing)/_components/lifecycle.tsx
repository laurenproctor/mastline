"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePrefersReducedMotion } from "./use-reduced-motion";

/**
 * The lifecycle chain, made walkable.
 *
 * `Opportunity -> Shoot -> Asset -> Submission -> License or usage -> Payment
 * -> Match or recovery` is the product constitution's own sentence and the
 * spine of the whole system, and on the How it works page it was seven words
 * and six arrows in a grey band -- the least interesting element on the page
 * carrying the most important idea.
 *
 * Walking it is the point. Each stage says what it keeps and, more usefully,
 * what it hands to the stage after it, which is where "one fact entered once"
 * stops being a slogan and becomes something a reader can trace. The handover
 * of the last stage points back at the first, because the archive re-entering
 * the queue is the loop closing rather than the story ending.
 *
 * It advances itself until the reader touches it, then it is theirs. Arrow
 * keys move along the chain, because a row of seven is a single control and
 * behaving like a tablist is what a keyboard expects of one.
 */

interface Stage {
  name: string;
  /** What the record itself preserves. */
  holds: string;
  /** What the next stage inherits without anyone retyping it. */
  hands: string;
}

const STAGES: readonly Stage[] = [
  {
    name: "Opportunity",
    holds: "The story, the source, the signal that raised it, the timing, and how relevant it is.",
    hands: "The subject, the angle, and the window, so the shoot opens already briefed.",
  },
  {
    name: "Shoot",
    holds: "Brief, logistics, people, place, time, team, costs, notes, and status.",
    hands: "Subject, location, date and credit, stamped onto every frame that comes in.",
  },
  {
    name: "Asset",
    holds:
      "The original and its derivatives, capture data, ownership, restrictions, and caption history.",
    hands:
      "The caption, the people, the places and the restrictions the dispatch is checked against.",
  },
  {
    name: "Submission",
    holds: "The package sent, the buyer, the time, the proposed terms, and the outcome.",
    hands: "Who has it, on what terms, and what they still owe an answer on.",
  },
  {
    name: "License or usage",
    holds: "Permitted use, territory, term, media, exclusivity, fee, and credit line.",
    hands: "The amount expected and the date it is due, without an invoice being retyped.",
  },
  {
    name: "Payment",
    holds: "Expected and received amounts, deductions, timing, splits, and aging.",
    hands: "Lifetime earnings on the picture, and the price band the next pitch is drawn from.",
  },
  {
    name: "Match or recovery",
    holds: "A suspected use, the evidence saved, a confidence score, and the case status.",
    hands: "Either an invoice, or a new opportunity — which is where this chain starts again.",
  },
];

/** Long enough to read a stage before it moves on. */
const DWELL_MS = 4200;

export function LifecycleChain() {
  const reduced = usePrefersReducedMotion();
  const root = useRef<HTMLDivElement>(null);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);

  const [active, setActive] = useState(0);
  const [running, setRunning] = useState(false);
  /** Once the reader picks a stage the chain stops moving on its own, for good. */
  const [driven, setDriven] = useState(false);

  const pick = useCallback((index: number) => {
    setActive(index);
    setDriven(true);
  }, []);

  useEffect(() => {
    const el = root.current;
    if (!el || reduced) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          setRunning(true);
          observer.disconnect();
        }
      },
      { threshold: 0.4 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [reduced]);

  useEffect(() => {
    if (!running || driven || reduced) return;
    // Stops at the last stage rather than looping. The chain has an end, and a
    // panel that cycles for ever behind a reader's back is noise.
    if (active >= STAGES.length - 1) return;
    const timer = setTimeout(() => setActive((i) => i + 1), DWELL_MS);
    return () => clearTimeout(timer);
  }, [running, driven, reduced, active]);

  const onKeyDown = (event: React.KeyboardEvent) => {
    const delta = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (delta === 0) return;
    event.preventDefault();
    const next = (active + delta + STAGES.length) % STAGES.length;
    pick(next);
    tabs.current[next]?.focus();
  };

  const stage = STAGES[active];

  return (
    <div className="lifecycle" ref={root}>
      <div
        aria-label="The commercial lifecycle of an image"
        className="lifecycle-chain"
        onKeyDown={onKeyDown}
        role="tablist"
      >
        {STAGES.map((entry, index) => (
          <button
            aria-controls="lifecycle-panel"
            aria-selected={index === active}
            className={index === active ? "on" : index < active ? "past" : ""}
            id={`lifecycle-tab-${index}`}
            key={entry.name}
            onClick={() => pick(index)}
            ref={(node) => {
              tabs.current[index] = node;
            }}
            role="tab"
            tabIndex={index === active ? 0 : -1}
            type="button"
          >
            <span className="lifecycle-n">{String(index + 1).padStart(2, "0")}</span>
            <span className="lifecycle-name">{entry.name}</span>
          </button>
        ))}
      </div>

      <div
        aria-labelledby={`lifecycle-tab-${active}`}
        className="lifecycle-panel"
        id="lifecycle-panel"
        role="tabpanel"
        tabIndex={0}
      >
        <div key={stage.name}>
          <span className="mk-eyebrow">{stage.name}</span>
          <dl>
            <div>
              <dt>What the record keeps</dt>
              <dd>{stage.holds}</dd>
            </div>
            <div>
              <dt>What the next step inherits</dt>
              <dd>{stage.hands}</dd>
            </div>
          </dl>
        </div>
      </div>
    </div>
  );
}
