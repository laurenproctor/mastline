"use client";

/**
 * The last resort, for a failure in the root layout itself.
 *
 * Renders its own html and body because the layout that would normally provide
 * them is the thing that failed. No shared components either, for the same
 * reason: whatever broke may be one of them.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          background: "#f4f2ec",
          color: "#11110f",
          fontFamily: "Inter, ui-sans-serif, -apple-system, sans-serif",
          padding: "24px",
        }}
      >
        <main style={{ maxWidth: 520 }}>
          <p
            style={{
              textTransform: "uppercase",
              letterSpacing: ".12em",
              fontSize: 10,
              fontWeight: 800,
              color: "#6f6e68",
              margin: 0,
            }}
          >
            Mastline
          </p>
          <h1
            style={{
              fontFamily: 'Georgia, "Times New Roman", serif',
              fontWeight: 400,
              fontSize: 40,
              letterSpacing: "-.035em",
              margin: "6px 0 12px",
            }}
          >
            Mastline could not start
          </h1>
          <p style={{ lineHeight: 1.6, margin: "0 0 8px" }}>
            Something failed before the page could load. Your shoots, assets, submissions, and
            financial records are unaffected.
          </p>
          <p style={{ fontSize: 12, color: "#6f6e68", lineHeight: 1.6 }}>
            Try reloading. If it keeps happening, quote this reference:{" "}
            <code>{error.digest ?? "none"}</code>
          </p>
          <button
            onClick={reset}
            style={{
              minHeight: 40,
              padding: "0 16px",
              border: "1px solid #11110f",
              background: "#11110f",
              color: "#fff",
              fontWeight: 750,
              cursor: "pointer",
              marginTop: 14,
            }}
            type="button"
          >
            Reload
          </button>
        </main>
      </body>
    </html>
  );
}
