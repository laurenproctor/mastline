import { describe, expect, it, vi } from "vitest";
import {
  connectionState,
  createTelemetry,
  IMPORT_EVENTS,
  scrub,
  sizeBucket,
  vercelSink,
  type ImportEventPayload,
} from "./telemetry";

/**
 * What the queue is allowed to say about a photograph.
 *
 * The answer is: how big it was, roughly, and what happened to it. Not what it
 * was called. A filename in this product names a subject and a location.
 */
describe("what leaves the browser", () => {
  it("drops anything not on the allow list", () => {
    const smuggled = {
      workspaceId: "org-1",
      attempt: 2,
      // Everything below is what someone debugging in a hurry would add.
      originalFilename: "harry-heathrow-arrivals.ARW",
      uploadUrl: "https://project.storage.supabase.co/upload/resumable/abc?token=xyz",
      authorization: "Bearer eyJhbGciOi",
      storagePath: "org/_staging/batch/file",
      capturedAt: "2026-08-19T18:47:18.000Z",
      localPath: "/Users/someone/Pictures/card/DCIM",
    } as unknown as ImportEventPayload;

    const safe = scrub(smuggled);

    expect(safe).toEqual({ workspaceId: "org-1", attempt: 2 });
    const serialized = JSON.stringify(safe);
    for (const forbidden of ["harry", "heathrow", "Bearer", "token", "supabase", "Users"]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("reports size as a range, never as a byte count", () => {
    expect(sizeBucket(900 * 1024)).toBe("<1MB");
    expect(sizeBucket(4 * 1024 * 1024)).toBe("1-8MB");
    expect(sizeBucket(20 * 1024 * 1024)).toBe("8-32MB");
    expect(sizeBucket(60 * 1024 * 1024)).toBe("32-128MB");
    expect(sizeBucket(400 * 1024 * 1024)).toBe("128MB+");
  });

  it("keeps only serialisable values", () => {
    const safe = scrub({ attempt: 1, errorCode: "offline", resumed: true, durationMs: 4200 });
    expect(safe).toEqual({ attempt: 1, errorCode: "offline", resumed: true, durationMs: 4200 });
  });
});

describe("emitting", () => {
  it("never lets a failing collector fail an import", () => {
    const telemetry = createTelemetry({
      emit: () => {
        throw new Error("the analytics script is broken");
      },
    });
    expect(() => telemetry.emit("upload_started")).not.toThrow();
  });

  it("times an operation", () => {
    let clock = 1_000;
    const telemetry = createTelemetry(undefined, () => clock);
    const done = telemetry.timer();
    clock = 4_500;
    expect(done()).toBe(3_500);
  });

  it("passes scrubbed payloads to the collector this app already has", () => {
    const track = vi.fn();
    vercelSink(track).emit("upload_completed", {
      workspaceId: "org-1",
      durationMs: 900,
      // Not on the list.
      ...({ originalFilename: "a.ARW" } as object),
    });

    expect(track).toHaveBeenCalledWith("upload_completed", {
      workspaceId: "org-1",
      durationMs: 900,
    });
  });

  it("covers every event the runbook names", () => {
    expect(IMPORT_EVENTS).toHaveLength(12);
    expect(IMPORT_EVENTS).toContain("import_recovered_after_reload");
    expect(IMPORT_EVENTS).toContain("finalization_failed");
  });
});

describe("connection state", () => {
  it("says offline when the browser does", () => {
    expect(connectionState({ navigator: { onLine: false } as Navigator })).toBe("offline");
  });

  it("includes the effective type when the browser offers one", () => {
    expect(
      connectionState({
        navigator: { onLine: true, connection: { effectiveType: "3g" } } as never,
      }),
    ).toBe("online:3g");
  });

  it("falls back to plain online", () => {
    expect(connectionState({ navigator: { onLine: true } as Navigator })).toBe("online");
    expect(connectionState({})).toBeUndefined();
  });
});
