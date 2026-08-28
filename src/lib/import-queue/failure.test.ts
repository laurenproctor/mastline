import { describe, expect, it } from "vitest";
import { classifyUploadFailure, isRetryable, messageFor } from "./failure";

/**
 * What each kind of failure means, and whether asking again could possibly
 * help. A queue that retries a refusal all night is worse than one that stops.
 */
describe("classifying an upload failure", () => {
  it("calls a lost connection offline, whatever the error looked like", () => {
    const failure = classifyUploadFailure({ error: new Error("network error"), online: false });
    expect(failure.code).toBe("offline");
    expect(failure.retryable).toBe(true);
  });

  it("separates an expired token from a refusal", () => {
    expect(classifyUploadFailure({ status: 401 }).code).toBe("authentication_expired");
    expect(classifyUploadFailure({ status: 401 }).refreshSession).toBe(true);

    // Supabase answers both with 403. The body is the only thing that tells
    // them apart, and getting it wrong costs one wasted refresh either way.
    expect(classifyUploadFailure({ status: 403, body: "jwt expired" }).code).toBe(
      "authentication_expired",
    );
    const denied = classifyUploadFailure({
      status: 403,
      body: "new row violates row-level security policy",
    });
    expect(denied.code).toBe("authorization_denied");
    expect(denied.retryable).toBe(false);
  });

  it("treats a missing upload URL as an expired session, not a broken file", () => {
    const failure = classifyUploadFailure({ status: 404, resuming: true });
    expect(failure.code).toBe("upload_session_expired");
    expect(failure.restartSession).toBe(true);
    expect(failure.retryable).toBe(true);
  });

  it("does not read a 404 on a fresh upload as an expired session", () => {
    expect(classifyUploadFailure({ status: 404, resuming: false }).code).toBe("server_unavailable");
  });

  it("recognises a conflict, a refused file, and a full account", () => {
    expect(classifyUploadFailure({ status: 409 }).code).toBe("object_conflict");
    expect(classifyUploadFailure({ status: 413 }).code).toBe("unsupported_file");
    expect(classifyUploadFailure({ status: 415 }).code).toBe("unsupported_file");
    expect(classifyUploadFailure({ status: 507 }).code).toBe("quota_exceeded");
  });

  it("retries the far end and not the request", () => {
    for (const status of [429, 500, 502, 503, 504]) {
      expect(classifyUploadFailure({ status }).retryable).toBe(true);
    }
    // A 4xx nobody anticipated does not improve by being asked again.
    expect(classifyUploadFailure({ status: 422 }).retryable).toBe(false);
  });

  it("calls a stall a timeout", () => {
    expect(classifyUploadFailure({ error: new Error("The upload timed out.") }).code).toBe(
      "timeout",
    );
    expect(classifyUploadFailure({ error: new Error("connection reset") }).code).toBe(
      "server_unavailable",
    );
  });

  it("will not retry the things a person has to fix", () => {
    for (const code of ["authorization_denied", "quota_exceeded", "unsupported_file", "file_missing"] as const) {
      expect(isRetryable(code)).toBe(false);
      // And every one of them says something a person could act on.
      expect(messageFor(code).length).toBeGreaterThan(20);
    }
  });
});
