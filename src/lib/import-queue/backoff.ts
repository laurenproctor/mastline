/**
 * How long to wait before trying again.
 *
 * Exponential, bounded, and jittered. Each of those is load-bearing:
 *
 *   * exponential, because a server that is down stays down for longer than a
 *     second, and a queue that asks every second is part of the problem;
 *   * bounded, because a photographer who comes back to the car after twenty
 *     minutes should not find the next attempt scheduled for an hour's time;
 *   * jittered, because a card dump is a hundred files failing at the same
 *     moment for the same reason, and a hundred identical retries would arrive
 *     together and fail together, forever.
 *
 * Full jitter -- a uniform sample from zero to the ceiling -- rather than a
 * small wobble around it. It spreads a batch far more evenly, and the shorter
 * waits it sometimes produces cost nothing when the network has actually come
 * back.
 */

export interface BackoffOptions {
  /** The first delay, in milliseconds. */
  readonly baseMs?: number;
  /** How much each attempt multiplies the ceiling. */
  readonly factor?: number;
  /** The longest this will ever wait. */
  readonly maxMs?: number;
  /** Injected for tests. Returns a number in [0, 1). */
  readonly random?: () => number;
}

export const DEFAULT_BACKOFF: Required<Omit<BackoffOptions, "random">> = {
  baseMs: 1_000,
  factor: 2,
  maxMs: 60_000,
};

/**
 * The delay before attempt number `attempt`, counting the first retry as 1.
 *
 * A floor of a quarter of the ceiling keeps full jitter from scheduling a
 * retry so soon that it is indistinguishable from not waiting at all.
 */
export function backoffDelay(attempt: number, options: BackoffOptions = {}): number {
  const { baseMs, factor, maxMs } = { ...DEFAULT_BACKOFF, ...options };
  const random = options.random ?? Math.random;

  const step = Math.max(1, Math.floor(attempt));
  const ceiling = Math.min(maxMs, baseMs * factor ** (step - 1));
  const floor = ceiling / 4;

  return Math.round(floor + random() * (ceiling - floor));
}

/** When the next attempt is due, given a clock. */
export function nextAttemptAt(attempt: number, now: Date, options: BackoffOptions = {}): string {
  return new Date(now.getTime() + backoffDelay(attempt, options)).toISOString();
}

/** Whether a scheduled attempt has come round yet. */
export function isDue(nextAttempt: string | undefined, now: Date): boolean {
  if (!nextAttempt) return true;
  const due = new Date(nextAttempt).getTime();
  return Number.isNaN(due) || due <= now.getTime();
}
