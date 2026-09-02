import type { StorageCapacity } from "./types";

/**
 * Whether this machine can actually hold what is about to be selected.
 *
 * The promise being made when a file is queued is that it will survive a
 * reload, and that promise is only as good as the space to keep a second copy
 * of the bytes. A quota refusal halfway through a card dump is the worst
 * possible moment to discover the answer, so the question is asked first and
 * the answer is shown before anything is copied.
 *
 * The assessment is a pure function of numbers so it can be reasoned about and
 * tested without a browser.
 */

/**
 * Headroom kept back beyond the files themselves.
 *
 * A tenth, and never less than 32 MB. The origin holds more than the staged
 * copies -- the metadata database, previews the page has generated, whatever
 * the browser caches -- and filling a quota exactly is how an eviction happens
 * to somebody else's data on the same origin.
 */
const MARGIN_FRACTION = 0.1;
const MINIMUM_MARGIN_BYTES = 32 * 1024 * 1024;

export interface CapacityAssessment {
  /** True only when there is provably room. Unknown quota is not sufficient. */
  readonly sufficient: boolean;
  readonly requiredBytes: number;
  readonly availableBytes?: number;
  readonly shortfallBytes: number;
  /** Whether this origin's storage is exempt from eviction under pressure. */
  readonly persisted: boolean;
  /** Plain language for the operator. Present whenever sufficient is false. */
  readonly warning?: string;
}

export function marginFor(bytes: number): number {
  return Math.max(MINIMUM_MARGIN_BYTES, Math.round(bytes * MARGIN_FRACTION));
}

export function assessCapacity(input: {
  requiredBytes: number;
  quota?: number;
  usage?: number;
  persisted: boolean;
}): CapacityAssessment {
  const { requiredBytes, quota, usage, persisted } = input;
  const needed = requiredBytes + marginFor(requiredBytes);

  // A browser that will not say how much room there is has not said there is
  // room. Reporting that as sufficient would be the one lie this feature
  // cannot afford.
  if (typeof quota !== "number" || !Number.isFinite(quota) || quota <= 0) {
    return {
      sufficient: false,
      requiredBytes,
      shortfallBytes: 0,
      persisted,
      warning:
        "This browser will not report how much storage is free, so these files cannot be guaranteed to survive a reload.",
    };
  }

  const available = Math.max(0, quota - (typeof usage === "number" ? usage : 0));
  if (available >= needed) {
    return {
      sufficient: true,
      requiredBytes,
      availableBytes: available,
      shortfallBytes: 0,
      persisted,
    };
  }

  return {
    sufficient: false,
    requiredBytes,
    availableBytes: available,
    shortfallBytes: needed - available,
    persisted,
    warning:
      "There is not enough free storage on this device to keep a recoverable copy of every file. Import in smaller batches, or free some space first.",
  };
}

/** navigator.storage, behind the interface the queue depends on. */
export class BrowserStorageCapacity implements StorageCapacity {
  constructor(private readonly manager: StorageManager) {}

  static create(scope: { navigator?: Navigator } = globalThis): BrowserStorageCapacity | null {
    const manager = scope.navigator?.storage;
    return manager && typeof manager.estimate === "function"
      ? new BrowserStorageCapacity(manager)
      : null;
  }

  async estimate(): Promise<{ quota?: number; usage?: number }> {
    try {
      const estimate = await this.manager.estimate();
      return { quota: estimate.quota, usage: estimate.usage };
    } catch {
      return {};
    }
  }

  async persisted(): Promise<boolean> {
    try {
      return typeof this.manager.persisted === "function" ? await this.manager.persisted() : false;
    } catch {
      return false;
    }
  }

  /**
   * Ask for storage that will not be evicted under pressure.
   *
   * Asked for once, when files are first selected, because that is the moment
   * the request is about something the person can see themselves doing. Some
   * browsers grant it silently on a site with engagement, some prompt, and some
   * refuse; a refusal is not an error, it is a fact the warning has to include.
   */
  async persist(): Promise<boolean> {
    try {
      return typeof this.manager.persist === "function" ? await this.manager.persist() : false;
    } catch {
      return false;
    }
  }
}
