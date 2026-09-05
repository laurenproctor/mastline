import { describe, expect, it } from "vitest";
import { BrowserQueueCoordinator, LEASE_TTL_MS } from "./coordination";

/**
 * Two tabs, one queue.
 *
 * The failure being prevented is specific: two tabs uploading the same file to
 * the same resumable session, which Supabase answers with 409, so a file that
 * was uploading perfectly well would be reported to the photographer as a
 * conflict.
 */

class FakeLockManager {
  readonly held = new Set<string>();

  async request(
    name: string,
    options: { ifAvailable?: boolean },
    callback: (lock: unknown) => Promise<unknown>,
  ): Promise<unknown> {
    if (this.held.has(name)) {
      // ifAvailable is what makes this non-blocking: the other tab's file is
      // not this tab's work to wait for.
      if (options.ifAvailable) return callback(null);
      throw new Error("would block");
    }
    this.held.add(name);
    try {
      return await callback({ name });
    } finally {
      this.held.delete(name);
    }
  }
}

class FakeStorage {
  private readonly rows = new Map<string, string>();
  getItem(key: string) {
    return this.rows.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.rows.set(key, value);
  }
  removeItem(key: string) {
    this.rows.delete(key);
  }
  get size() {
    return this.rows.size;
  }
  raw(key: string) {
    return this.rows.get(key);
  }
}

const channels = new Map<string, FakeChannel[]>();

class FakeChannel {
  onmessage: ((event: MessageEvent) => void) | null = null;
  constructor(readonly name: string) {
    channels.set(name, [...(channels.get(name) ?? []), this]);
  }
  postMessage(data: unknown) {
    for (const peer of channels.get(this.name) ?? []) {
      if (peer !== this) peer.onmessage?.({ data } as MessageEvent);
    }
  }
  close() {
    channels.set(
      this.name,
      (channels.get(this.name) ?? []).filter((peer) => peer !== this),
    );
  }
}

function webLocksScope(locks: FakeLockManager) {
  return { navigator: { locks } as unknown as Navigator };
}

describe("with the Web Locks API", () => {
  it("gives one tab the file and tells the other to move on", async () => {
    const locks = new FakeLockManager();
    const first = new BrowserQueueCoordinator(webLocksScope(locks), { ownerId: "tab-a" });
    const second = new BrowserQueueCoordinator(webLocksScope(locks), { ownerId: "tab-b" });

    const held = await first.acquire("file-1");
    expect(held).not.toBeNull();

    // Not queued behind it. Null means "not yours", and the runner goes and
    // finds another file rather than waiting.
    expect(await second.acquire("file-1")).toBeNull();

    await held!.release();
    const after = await second.acquire("file-1");
    expect(after).not.toBeNull();
    await after!.release();
  });

  it("refuses a second worker inside one tab", async () => {
    const coordinator = new BrowserQueueCoordinator(webLocksScope(new FakeLockManager()), {
      ownerId: "tab-a",
    });
    const held = await coordinator.acquire("file-1");
    expect(await coordinator.acquire("file-1")).toBeNull();
    await held!.release();
    expect(await coordinator.acquire("file-1")).not.toBeNull();
  });

  it("says which mechanism it is using", () => {
    expect(new BrowserQueueCoordinator(webLocksScope(new FakeLockManager())).kind).toBe(
      "web-locks",
    );
  });
});

describe("with a lease, when there are no Web Locks", () => {
  const settle = () => Promise.resolve();

  it("writes an owner and an expiry, never an open-ended lock", async () => {
    const storage = new FakeStorage();
    const now = 1_000_000;
    const coordinator = new BrowserQueueCoordinator(
      { localStorage: storage as unknown as Storage },
      { ownerId: "tab-a", now: () => now, settle },
    );

    expect(coordinator.kind).toBe("lease");
    const held = await coordinator.acquire("file-1");
    expect(held).not.toBeNull();

    const lease = JSON.parse(storage.raw("mastline-import-lease:file-1")!);
    expect(lease.owner).toBe("tab-a");
    // Bounded, always. A lock with no expiry is a file lost to a crashed tab.
    expect(lease.expiresAt).toBe(now + LEASE_TTL_MS);
  });

  it("keeps another tab out while the lease is alive", async () => {
    const storage = new FakeStorage();
    let now = 1_000_000;
    const clock = () => now;
    const a = new BrowserQueueCoordinator(
      { localStorage: storage as unknown as Storage },
      { ownerId: "tab-a", now: clock, settle },
    );
    const b = new BrowserQueueCoordinator(
      { localStorage: storage as unknown as Storage },
      { ownerId: "tab-b", now: clock, settle },
    );

    await a.acquire("file-1");
    expect(await b.acquire("file-1")).toBeNull();

    // The tab holding it went away without releasing. The lease expires.
    now += LEASE_TTL_MS + 1;
    const taken = await b.acquire("file-1");
    expect(taken).not.toBeNull();
  });

  it("renews while the work is running", async () => {
    const storage = new FakeStorage();
    let now = 1_000_000;
    const coordinator = new BrowserQueueCoordinator(
      { localStorage: storage as unknown as Storage },
      { ownerId: "tab-a", now: () => now, settle },
    );

    const held = await coordinator.acquire("file-1");
    now += 6_000;
    expect(await held!.renew()).toBe(true);
    expect(JSON.parse(storage.raw("mastline-import-lease:file-1")!).expiresAt).toBe(
      now + LEASE_TTL_MS,
    );
  });

  it("tells the loser of a takeover to stop", async () => {
    const storage = new FakeStorage();
    let now = 1_000_000;
    const clock = () => now;
    const a = new BrowserQueueCoordinator(
      { localStorage: storage as unknown as Storage },
      { ownerId: "tab-a", now: clock, settle },
    );
    const b = new BrowserQueueCoordinator(
      { localStorage: storage as unknown as Storage },
      { ownerId: "tab-b", now: clock, settle },
    );

    const held = await a.acquire("file-1");
    now += LEASE_TTL_MS + 1;
    await b.acquire("file-1");

    // A renewal that comes back false is the signal to abort: another tab
    // believes it owns this file now.
    expect(await held!.renew()).toBe(false);
  });

  it("gives the lease back on release", async () => {
    const storage = new FakeStorage();
    const coordinator = new BrowserQueueCoordinator(
      { localStorage: storage as unknown as Storage },
      { ownerId: "tab-a", settle },
    );

    const held = await coordinator.acquire("file-1");
    await held!.release();
    expect(storage.size).toBe(0);
  });
});

describe("telling the other tab", () => {
  it("delivers a change to peers and not to itself", () => {
    channels.clear();
    const scope = { BroadcastChannel: FakeChannel as unknown as typeof BroadcastChannel };

    const a = new BrowserQueueCoordinator(scope, { ownerId: "tab-a" });
    const b = new BrowserQueueCoordinator(scope, { ownerId: "tab-b" });

    const heard: string[] = [];
    b.subscribe((message) => heard.push(message.kind));
    const ownHeard: string[] = [];
    a.subscribe((message) => ownHeard.push(message.kind));

    a.publish({ kind: "changed", ownerId: "tab-a" });

    expect(heard).toEqual(["changed"]);
    expect(ownHeard).toEqual([]);

    a.close();
    b.close();
  });

  it("works with no channel at all", () => {
    const coordinator = new BrowserQueueCoordinator({}, { ownerId: "tab-a" });
    expect(coordinator.kind).toBe("none");
    expect(() => coordinator.publish({ kind: "changed", ownerId: "tab-a" })).not.toThrow();
  });
});
