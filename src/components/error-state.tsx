"use client";

import Link from "next/link";

/**
 * What a person sees when something breaks.
 *
 * Three things matter more than the error itself: that their work is safe, that
 * there is something to try, and that there is a way out. A stack trace serves
 * none of those, so the message stays plain and the digest is offered quietly
 * for when someone needs to report it.
 */
export function ErrorState({
  title,
  detail,
  digest,
  onRetry,
  backHref = "/work",
  backLabel = "Back to the work queue",
}: {
  title: string;
  detail: string;
  digest?: string;
  onRetry?: () => void;
  backHref?: string;
  backLabel?: string;
}) {
  return (
    <div className="error-state" role="alert">
      <div className="eyebrow">Something went wrong</div>
      <h1>{title}</h1>
      <p>{detail}</p>
      <p className="section-note">
        Nothing imported, sent or recorded is affected. This is a problem displaying the page, not a
        problem with the records.
      </p>

      <div className="actions">
        {onRetry && (
          <button className="button primary" onClick={onRetry} type="button">
            Try again
          </button>
        )}
        <Link className="button" href={backHref}>
          {backLabel}
        </Link>
      </div>

      {digest && (
        <p className="section-note error-digest">
          Reference <code>{digest}</code> — quote this when reporting it.
        </p>
      )}
    </div>
  );
}
