import type { QueueBroadcast, QueueCoordinator, QueueLock } from "./types";

/**
 * Keeping two Mastline tabs out of each other's way.
 *
 * Two tabs is not a hypothetical. A photographer opens a shoot in a second tab
 * to check a caption while a card is uploading in the first, and both tabs load
 * the same IndexedDB queue and see the same outstanding files. Without a lock
 * both would upload the same bytes: Supabase answers the second writer to a
 * session with 409, so one tab would report a conflict for a file that was
 * uploading perfectly well, and the operator would be told a frame had failed
 * when it had not.
 *
 * Two mechanisms, in order of preference:
 *
 *   * The Web Locks API, which is exactly this problem and releases a lock
 *     automatically when the tab holding it goes away -- including a crash,
 *     which is the case a hand-rolled lock always gets wrong.
 *   * A lease in localStorage, for browsers without it. Every lease has an
 *     owner and an expiry and must be renewed; nothing is ever held
 *     indefinitely, so a tab that dies stalls one file for fifteen seconds
 *     rather than forever.
 *
 * State changes are published over BroadcastChannel so the other tab's list
 * moves as work happens, rather than showing a queue that quietly stopped being
 * true. Messages are hints to re-read the store: nothing is trusted from
 * another tab, because a message is not evidence.
 */

const CHANNEL = "mastline-import-queue";
const LEASE_PREFIX = "mastline-import-lease:";

/**
 * How long a lease lasts, and how often its holder renews it.
 *
 * Fifteen seconds is long enough to survive a stalled main thread and a slow
 * chunk boundary, and short enough that a tab closed mid-upload does not hold
 * a file hostage for longer than somebody would wait before pressing retry.
 */
export const LEASE_TTL_MS = 15_000;
export const LEASE_RENEW_MS = 5_000;

interface Lease {
  readonly owner: string;
  readonly expiresAt: number;
}

export interface CoordinatorScope {
  readonly navigator?: Navigator;
  readonly localStorage?: Storage;
  readonly BroadcastChannel?: typeof BroadcastChannel;
}

export interface CoordinatorOptions {
  readonly ownerId?: string;
  readonly now?: () => number;
  /** Lets a test settle a lease race deterministically. */
  readonly settle?: () => Promise<void>;
}

/** Web Locks, when the browser has them. */
class WebLocksStrategy {
  readonly kind = "web-locks" as const;

  constructor(private readonly locks: LockManager) {}

  async acquire(name: string): Promise<Omit<QueueLock, "key"> | null> {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });

    const granted = await new Promise<boolean>((resolve) => {
      // ifAvailable: never queue behind the other tab. A file another tab is
      // already uploading is not this tab's work to wait for; there are other
      // files to get on with.
      void this.locks
        .request(name, { mode: "exclusive", ifAvailable: true }, async (lock) => {
          if (!lock) {
            resolve(false);
            return;
          }
          resolve(true);
          await held;
        })
        .catch(() => resolve(false));
    });

    if (!granted) return null;
    return {
      // Nothing to renew: the browser holds it until this tab releases it or
      // stops existing.
      renew: async () => true,
      release: async () => release(),
    };
  }
}

/** A renewable lease, for browsers without Web Locks. */
class LeaseStrategy {
  readonly kind = "lease" as const;

  constructor(
    private readonly storage: Storage,
    private readonly ownerId: string,
    private readonly now: () => number,
    private readonly settle: () => Promise<void>,
  ) {}

  private read(key: string): Lease | null {
    try {
      const raw = this.storage.getItem(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Partial<Lease>;
      return typeof parsed.owner === "string" && typeof parsed.expiresAt === "number"
        ? { owner: parsed.owner, expiresAt: parsed.expiresAt }
        : null;
    } catch {
      return null;
    }
  }

  private write(key: string, lease: Lease): boolean {
    try {
      this.storage.setItem(key, JSON.stringify(lease));
      return true;
    } catch {
      return false;
    }
  }

  async acquire(name: string): Promise<Omit<QueueLock, "key"> | null> {
    const key = `${LEASE_PREFIX}${name}`;
    const existing = this.read(key);
    const now = this.now();

    // Somebody else holds it and is still alive.
    if (existing && existing.owner !== this.ownerId && existing.expiresAt > now) return null;

    if (!this.write(key, { owner: this.ownerId, expiresAt: now + LEASE_TTL_MS })) return null;

    // Two tabs can pass the check above in the same instant and both write.
    // Reading back after letting the other write land makes that a race with a
    // loser rather than a race with two winners.
    await this.settle();
    if (this.read(key)?.owner !== this.ownerId) return null;

    return {
      renew: async () => {
        const current = this.read(key);
        const at = this.now();
        // Lost it: either taken over after an expiry, or cleared. Either way,
        // this tab must stop -- which is what returning false tells the runner.
        if (current && current.owner !== this.ownerId && current.expiresAt > at) return false;
        return this.write(key, { owner: this.ownerId, expiresAt: at + LEASE_TTL_MS });
      },
      release: async () => {
        if (this.read(key)?.owner !== this.ownerId) return;
        try {
          this.storage.removeItem(key);
        } catch {
          // It expires on its own within fifteen seconds.
        }
      },
    };
  }
}

/** No coordination available. Honest about it rather than pretending. */
class SoloStrategy {
  readonly kind = "none" as const;
  async acquire(): Promise<Omit<QueueLock, "key"> | null> {
    return { renew: async () => true, release: async () => {} };
  }
}

type Strategy = WebLocksStrategy | LeaseStrategy | SoloStrategy;

export class BrowserQueueCoordinator implements QueueCoordinator {
  readonly ownerId: string;
  readonly kind: QueueCoordinator["kind"];
  private readonly strategy: Strategy;
  private readonly channel: BroadcastChannel | null;
  private readonly listeners = new Set<(message: QueueBroadcast) => void>();
  private readonly held = new Set<string>();

  constructor(scope: CoordinatorScope = globalThis, options: CoordinatorOptions = {}) {
    this.ownerId = options.ownerId ?? crypto.randomUUID();

    const locks = scope.navigator?.locks;
    if (locks && typeof locks.request === "function") {
      this.strategy = new WebLocksStrategy(locks);
    } else if (scope.localStorage) {
      this.strategy = new LeaseStrategy(
        scope.localStorage,
        this.ownerId,
        options.now ?? (() => Date.now()),
        options.settle ?? (() => new Promise((resolve) => setTimeout(resolve, 25))),
      );
    } else {
      this.strategy = new SoloStrategy();
    }
    this.kind = this.strategy.kind;

    const Channel = scope.BroadcastChannel;
    this.channel = Channel ? new Channel(CHANNEL) : null;
    if (this.channel) {
      this.channel.onmessage = (event: MessageEvent) => {
        const message = event.data as QueueBroadcast;
        // A tab does not need to hear its own announcements.
        if (!message || message.ownerId === this.ownerId) return;
        for (const listener of this.listeners) listener(message);
      };
    }
  }

  async acquire(key: string): Promise<QueueLock | null> {
    // Within one tab, one worker per item. The lock strategies are between
    // tabs; this is the same guarantee inside this one, and it is cheaper than
    // asking the browser.
    if (this.held.has(key)) return null;
    this.held.add(key);

    const lock = await this.strategy.acquire(key);
    if (!lock) {
      this.held.delete(key);
      return null;
    }

    this.publish({ kind: "claimed", ownerId: this.ownerId, clientFileId: key });

    let released = false;
    return {
      key,
      renew: () => lock.renew(),
      release: async () => {
        if (released) return;
        released = true;
        this.held.delete(key);
        await lock.release();
        this.publish({ kind: "released", ownerId: this.ownerId, clientFileId: key });
      },
    };
  }

  publish(message: QueueBroadcast): void {
    try {
      this.channel?.postMessage(message);
    } catch {
      // A closed channel is not worth failing an upload over.
    }
  }

  subscribe(listener: (message: QueueBroadcast) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  close(): void {
    this.listeners.clear();
    try {
      this.channel?.close();
    } catch {
      // Already closed.
    }
  }
}
