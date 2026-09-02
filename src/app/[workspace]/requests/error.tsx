"use client";

import { useEffect } from "react";
import { ErrorState } from "@/components/error-state";

/**
 * The error boundary for the requests inbox and everything under it.
 *
 * The application boundary in src/app/error.tsx would catch these too, but it
 * offers "Back to the work queue" and speaks about pages in general. Somebody
 * whose inbox failed to load is in the middle of answering a picture desk, and
 * the useful thing to tell them is the specific one: nothing they recorded is
 * affected, and no buyer was contacted either way.
 *
 * There is deliberately no `loading.tsx` beside this. A route-level loading
 * file puts its whole subtree in a Suspense boundary, which left Server Actions
 * that call `revalidatePath` hanging on "Saving…" for ever --
 * tests/route-loading-boundary.test.ts asserts none comes back. Pending state
 * lives on the controls instead, where the form already renders it.
 */
export default function RequestsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Server digests are opaque by design, so the console is where a developer
    // sees what actually happened.
    console.error("Requests route error:", error);
  }, [error]);

  const isPermission = /may not|permission|not allowed/i.test(error.message);

  return (
    <ErrorState
      detail={
        isPermission
          ? "This role does not allow that. An owner can change it."
          : "The requests inbox could not be loaded. Every request already recorded is safe, and no buyer has been contacted."
      }
      digest={error.digest}
      onRetry={isPermission ? undefined : reset}
      title={isPermission ? "No access to that" : "The inbox did not load"}
    />
  );
}
