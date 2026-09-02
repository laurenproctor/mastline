"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * The recipient's gallery: one photograph at a time, read like a contact
 * sheet a desk was handed rather than an administrative table.
 *
 * Keyboard first: left and right arrows move between frames, and the hint
 * says so. The visible frame carries `data-asset-id`, which is the hook the
 * viewing tracker's IntersectionObserver reads — so with measurement
 * consented, time accrues against the frame actually on screen and no other.
 *
 * Nothing here decides access. The preview route serves only marked images
 * and the frame route re-checks acceptance, expiry, and the full-resolution
 * offer in the database; this component just draws what the page was given.
 */

export interface GalleryFrame {
  readonly assetId: string;
  readonly filename: string;
  readonly headline?: string;
  readonly caption?: string;
  readonly people: readonly string[];
  readonly capturedLabel?: string;
  readonly hasPreview: boolean;
}

export function DeliveryGallery({
  token,
  frames,
  accepted,
  allowFullResolution,
  creditLine,
  locationLabel,
}: {
  token: string;
  frames: readonly GalleryFrame[];
  accepted: boolean;
  allowFullResolution: boolean;
  creditLine?: string;
  /** Where the photographs were taken, when the record says. */
  locationLabel?: string;
}) {
  const [index, setIndex] = useState(0);
  const [copied, setCopied] = useState<"idle" | "done" | "failed">("idle");
  const total = frames.length;
  const frame = frames[Math.min(index, total - 1)];
  const liveRef = useRef<HTMLParagraphElement>(null);

  const move = useCallback(
    (delta: number) => {
      setIndex((current) => Math.min(Math.max(current + delta, 0), total - 1));
      setCopied("idle");
    },
    [total],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && /^(input|textarea|select)$/i.test(target.tagName)) return;
      if (event.key === "ArrowRight") move(1);
      if (event.key === "ArrowLeft") move(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [move]);

  if (!frame) return null;

  const credit = creditLine ?? "";

  return (
    <section aria-label="Photographs" className="delivery-gallery">
      <div className="delivery-gallery__stage">
        <figure className="delivery-gallery__media" data-asset-id={frame.assetId}>
          {frame.hasPreview ? (
            /* Served through the route so the only version a recipient can
               reach carries their name, rendered from the exact object that
               was approved. A signed URL here would hand over the clean file. */
            // eslint-disable-next-line @next/next/no-img-element
            <img
              alt={frame.headline ?? frame.filename}
              src={`/d/${token}/preview/${frame.assetId}`}
            />
          ) : (
            <div className="delivery-frame-blank">No preview · {frame.filename}</div>
          )}
        </figure>

        {total > 1 && (
          <ul aria-label="All photographs" className="delivery-gallery__thumbs">
            {frames.map((candidate, candidateIndex) => (
              <li key={candidate.assetId}>
                <button
                  aria-current={candidateIndex === index ? "true" : undefined}
                  aria-label={`Photograph ${candidateIndex + 1} of ${total}`}
                  className="delivery-gallery__thumb"
                  onClick={() => {
                    setIndex(candidateIndex);
                    setCopied("idle");
                  }}
                  type="button"
                >
                  {candidate.hasPreview ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img alt="" loading="lazy" src={`/d/${token}/preview/${candidate.assetId}`} />
                  ) : (
                    <span aria-hidden="true">{candidateIndex + 1}</span>
                  )}
                  <span aria-hidden="true" className="delivery-gallery__thumb-ordinal">
                    {String(candidateIndex + 1).padStart(2, "0")}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <aside className="delivery-gallery__rail">
        <div className="delivery-gallery__pager">
          <p aria-live="polite" className="delivery-gallery__count" ref={liveRef}>
            {String(index + 1).padStart(2, "0")} / {String(total).padStart(2, "0")}
          </p>
          {total > 1 && (
            <p className="delivery-gallery__arrows">
              <button
                aria-label="Previous photograph"
                className="delivery-gallery__arrow"
                disabled={index === 0}
                onClick={() => move(-1)}
                type="button"
              >
                ←
              </button>
              <button
                aria-label="Next photograph"
                className="delivery-gallery__arrow"
                disabled={index === total - 1}
                onClick={() => move(1)}
                type="button"
              >
                →
              </button>
            </p>
          )}
        </div>

        <h2 className="delivery-gallery__headline">{frame.headline ?? frame.filename}</h2>

        {frame.caption && (
          <div className="delivery-gallery__field">
            <h3>Caption</h3>
            <p>{frame.caption}</p>
          </div>
        )}

        <div className="delivery-gallery__field">
          <h3>People</h3>
          {/* As the photographer recorded them at approval. Nothing here is
              inferred from the picture. */}
          <p data-people>
            {frame.people.length > 0 ? frame.people.join(", ") : "No people identified"}
          </p>
        </div>

        {(frame.capturedLabel || locationLabel) && (
          <div className="delivery-gallery__field">
            <h3>Captured</h3>
            <p>
              {frame.capturedLabel}
              {frame.capturedLabel && locationLabel ? " · " : ""}
              {locationLabel}
            </p>
          </div>
        )}

        <div className="delivery-gallery__actions">
          {accepted && allowFullResolution ? (
            <a className="delivery-gallery__download" href={`/d/${token}/frame/${frame.assetId}`}>
              Download full resolution <span aria-hidden="true">↓</span>
            </a>
          ) : accepted ? (
            <p className="section-note">
              Full-resolution files are not offered on this link. The marked previews are the
              delivery.
            </p>
          ) : (
            <p className="section-note">
              Accept the terms above to download the full-resolution file.
            </p>
          )}

          {credit && (
            <div className="delivery-gallery__credit">
              <button
                className="delivery-gallery__copy"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(credit);
                    setCopied("done");
                  } catch {
                    setCopied("failed");
                  }
                }}
                type="button"
              >
                Copy credit line
              </button>
              <span aria-live="polite" className="delivery-gallery__copied">
                {copied === "done" && "Copied."}
                {copied === "failed" && `Copy failed — the credit is: ${credit}`}
              </span>
            </div>
          )}
        </div>

        {total > 1 && (
          <p className="delivery-gallery__hint">
            <span aria-hidden="true">⌨</span> Use arrow keys to browse
          </p>
        )}
      </aside>
    </section>
  );
}
