"use client";

import { useEffect } from "react";
import { ErrorState } from "@/components/error-state";

/**
 * The application error boundary.
 *
 * A permission failure and a dropped connection need different words: one is a
 * dead end, the other is worth retrying. Anything else gets the general case
 * rather than a guess.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Server digests are opaque by design, so the console is where a developer
    // sees what actually happened.
    console.error("Route error:", error);
  }, [error]);

  const isPermission = /may not|permission|not allowed/i.test(error.message);
  const isReadOnly = /read-only/i.test(error.message);

  if (isReadOnly) {
    return (
      <ErrorState
        backHref="/settings"
        backLabel="Open settings"
        detail="This workspace is read-only, so that change was not saved. Everything is still readable and you can export all of it."
        digest={error.digest}
        title="This workspace is read-only"
      />
    );
  }

  if (isPermission) {
    return (
      <ErrorState
        detail="Your role does not allow that. If you think it should, ask an owner to change your role."
        digest={error.digest}
        title="You do not have access to that"
      />
    );
  }

  return (
    <ErrorState
      detail="The page could not be loaded. This is usually a connection problem and usually passes."
      digest={error.digest}
      onRetry={reset}
      title="That page did not load"
    />
  );
}
