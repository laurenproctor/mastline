"use client";

/**
 * A failure on the public intake page.
 *
 * Deliberately says nothing. A stranger holding a token gets no database
 * message, no constraint name, and no clue about whether their link is real --
 * the detail is on the server, where the photographer's own logs can carry it.
 */
export default function RequestIntakeError({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="auth-page">
      <div className="auth-card">
        <h1>Something went wrong</h1>
        <p className="section-note">
          Nothing was sent. Try again, and if it keeps happening, tell whoever sent you this link.
        </p>
        <button className="button" onClick={reset} type="button">
          Try again
        </button>
      </div>
    </main>
  );
}
