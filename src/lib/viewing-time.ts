/**
 * When a delivery page counts as being looked at.
 *
 * Pulled out of the tracker component so it can be argued with directly. The
 * whole difficulty in measuring attention is that "the page was open" and
 * "somebody was looking at it" are very different claims, and the easy
 * implementation reports the first while appearing to report the second. These
 * are the conditions that separate them.
 *
 * The browser is not trusted with the answer -- the server clamps every
 * duration against its own clock, a per-beat ceiling, and a monotonic sequence.
 * This is the polite half of the arrangement: it stops the page proposing time
 * it has no business proposing in the first place.
 */

/** No pointer, key, scroll, or touch for this long and the visitor has gone. */
export const IDLE_MS = 120_000;

/** A tick that claims more than this lost the thread; count the tick, not the gap. */
export const MAX_TICK_MS = 2_000;

/** Half the frame on screen before it counts as being looked at. */
export const VISIBLE_RATIO = 0.5;

export interface ViewingConditions {
  /** document.visibilityState === "visible" */
  readonly documentVisible: boolean;
  /** document.hasFocus() */
  readonly windowFocused: boolean;
  /** Since the last pointer, key, scroll, or touch event. */
  readonly msSinceActivity: number;
}

/**
 * Whether this instant counts towards active viewing time.
 *
 * All three have to hold. A background tab is not viewing. A visible but
 * unfocused window sitting behind another one is not viewing either -- it is
 * on screen and nobody is reading it. And a page nobody has touched for two
 * minutes is a desk somebody walked away from with the tab still open, which is
 * the single most common way a naive implementation invents an afternoon of
 * attention.
 */
export function isActivelyViewing(conditions: ViewingConditions): boolean {
  return (
    conditions.documentVisible && conditions.windowFocused && conditions.msSinceActivity < IDLE_MS
  );
}

/**
 * How much of the interval since the last tick may be counted.
 *
 * Bounded by the wall clock so a timer throttled in a background tab wakes up
 * owing itself one tick rather than the whole gap it slept through, and never
 * negative if the clock moves backwards.
 */
export function countableTickMs(elapsedMs: number): number {
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return 0;
  return Math.min(elapsedMs, MAX_TICK_MS);
}

/** Whether a photograph is meaningfully on screen, rather than one pixel of it. */
export function isMeaningfullyVisible(intersectionRatio: number): boolean {
  return intersectionRatio >= VISIBLE_RATIO;
}
