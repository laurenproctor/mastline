"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { formatDateTime } from "@/lib/format";
import styles from "./dispatch-review.module.css";
import { FrameFix } from "./frame-fix";

/**
 * What the desk will receive.
 *
 * The photographs are the screen. Everything the old table said is still here,
 * moved behind a disclosure rather than deleted -- a reviewer needs editorial
 * meaning to decide and technical certainty to prove, and those are different
 * moments.
 *
 * Three rules this component exists to keep:
 *
 *   Nothing is invented. A missing headline says so. A caption a model drafted
 *   and nobody has read says so, because text existing is not the same as text
 *   somebody stands behind. People come from stored metadata and nowhere else:
 *   this screen never looks at a face.
 *
 *   Every frame stays reachable. A package of twelve shows three and opens the
 *   rest; a photographer must never be asked to approve frames they cannot see.
 *
 *   Nothing here sends. Desk preview is a rehearsal of what a recipient would
 *   read, and creates no link, records no share, and marks nothing delivered.
 */

export interface ReviewFrame {
  readonly assetId: string;
  readonly position: number;
  readonly assetHref: string;
  readonly previewUrl?: string;
  readonly assetKind: string;
  readonly filename: string;

  readonly headline?: string;
  readonly caption?: string;
  readonly captionAwaitsReview: boolean;
  readonly captionOrigin?: "human" | "model";
  readonly people: readonly string[];

  readonly credit?: string;
  readonly copyright?: string;
  readonly location?: string;
  readonly usageRestrictions?: string;
  readonly capturedAt?: string;

  readonly versionKind?: string;
  readonly sha256?: string;
  readonly width?: number;
  readonly height?: number;
  readonly mimeType?: string;
  readonly bytes?: number;

  readonly missingRequired: readonly string[];
  readonly missingRecommended: readonly string[];
}

const ABOVE_THE_FOLD = 3;

function bytesLabel(bytes?: number): string | undefined {
  if (bytes === undefined || Number.isNaN(bytes)) return undefined;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Alt text a screen reader can use.
 *
 * The headline when there is one, because that is what the picture is of. The
 * filename otherwise -- not "photograph", which tells somebody nothing they
 * could not already guess from the element.
 */
function altFor(frame: ReviewFrame): string {
  if (frame.headline) return frame.headline;
  return `Frame ${frame.position + 1}, ${frame.filename}`;
}

function Shot({ frame }: { frame: ReviewFrame }) {
  return (
    <div className={styles.shot}>
      {frame.previewUrl ? (
        <>
          {/*
            A signed, short-lived URL into the private derivatives bucket, which
            next/image would proxy and cache. The original and the recipient's
            delivery version are both deliberately out of reach from here.
          */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img alt={altFor(frame)} src={frame.previewUrl} />
          {frame.assetKind === "video" && <span className={styles.kindTag}>Video</span>}
        </>
      ) : (
        <p className={styles.noShot}>
          <span>No preview available</span>
          <span>{frame.filename}</span>
        </p>
      )}
    </div>
  );
}

/**
 * Headline, caption, people. In that order, and only those three.
 *
 * Filenames, checksums, dimensions and version kinds are all still available
 * and all still one disclosure away. None of them belongs under a photograph
 * somebody is reading to decide whether it says what they think it says.
 */
function EditorialMeta({ frame }: { frame: ReviewFrame }) {
  const [openCaption, setOpenCaption] = useState(false);
  const captionId = useId();
  const longCaption = (frame.caption?.length ?? 0) > 150;

  return (
    <dl className={styles.meta}>
      <div className={styles.metaRow}>
        <dt>Headline</dt>
        <dd className={frame.headline ? styles.headlineValue : styles.missing}>
          {frame.headline ?? "Headline missing"}
        </dd>
      </div>

      <div className={styles.metaRow}>
        <dt>Caption</dt>
        <dd>
          {frame.caption ? (
            <>
              <span
                className={longCaption && !openCaption ? styles.captionClamp : undefined}
                id={captionId}
              >
                {frame.caption}
              </span>
              {longCaption && (
                <button
                  aria-controls={captionId}
                  aria-expanded={openCaption}
                  className={styles.moreLink}
                  onClick={() => setOpenCaption((open) => !open)}
                  type="button"
                >
                  {openCaption ? "Show less" : "Read the full caption"}
                </button>
              )}
              {/*
                Words, not a colour. A caption a model wrote and nobody has read
                is not a caption the photographer has stood behind, and the
                difference has to survive being printed in black and white.
              */}
              {frame.captionAwaitsReview && (
                <span className={styles.awaiting}>Caption awaiting review</span>
              )}
            </>
          ) : (
            <span className={styles.missing}>Caption missing</span>
          )}
        </dd>
      </div>

      <div className={styles.metaRow}>
        <dt>People</dt>
        <dd className={frame.people.length > 0 ? undefined : styles.missing}>
          {frame.people.length > 0 ? frame.people.join(", ") : "People not identified"}
        </dd>
      </div>
    </dl>
  );
}

function FrameCard({
  frame,
  fixable,
  open,
  onToggleFix,
  workspaceSlug,
  shootId,
}: {
  frame: ReviewFrame;
  fixable: boolean;
  open: boolean;
  onToggleFix: (assetId: string | null) => void;
  workspaceSlug: string;
  shootId: string;
}) {
  const blocked = frame.missingRequired.length > 0;
  const ref = useRef<HTMLElement>(null);

  // Opened from the summary above: bring the frame to the operator rather than
  // making them hunt for the one that was named.
  useEffect(() => {
    // Optional call: scrolling is a courtesy, and an environment without it
    // (jsdom, an older engine) should still render the editor rather than
    // throw on the way to it.
    if (open) ref.current?.scrollIntoView?.({ behavior: "smooth", block: "center" });
  }, [open]);

  return (
    <article className={styles.frame} id={`frame-${frame.assetId}`} ref={ref}>
      <p className={styles.frameIndex}>
        {String(frame.position + 1).padStart(2, "0")}
        {blocked && <span className={styles.frameBlocked}>Needs work</span>}
      </p>
      <Shot frame={frame} />
      <EditorialMeta frame={frame} />

      {blocked && (
        <>
          <p className={styles.frameMissing}>
            Missing before this can be sent: {frame.missingRequired.join(", ")}
          </p>
          {fixable ? (
            <button
              aria-expanded={open}
              className={styles.fixButton}
              onClick={() => onToggleFix(open ? null : frame.assetId)}
              type="button"
            >
              {open ? "Close" : "Fix this frame"}
            </button>
          ) : (
            <p className={styles.fixNote}>
              Editing a frame needs the asset-write permission.{" "}
              <Link className="text-link" href={frame.assetHref}>
                Open the asset
              </Link>
            </p>
          )}
        </>
      )}

      {open && fixable && (
        <FrameFix
          assetId={frame.assetId}
          filename={frame.filename}
          missing={frame.missingRequired}
          onDone={() => onToggleFix(null)}
          shootId={shootId}
          values={{
            caption: frame.caption,
            headline: frame.headline,
            creditLine: frame.credit,
            copyrightNotice: frame.copyright,
            subjects: frame.people,
            locationName: frame.location,
            usageRestrictions: frame.usageRestrictions,
          }}
          workspaceSlug={workspaceSlug}
        />
      )}
    </article>
  );
}

/**
 * What has to change, named and reachable.
 *
 * A blocked package used to say "2 checks need review" and leave the operator
 * to work out which frames and where. Each line here names the frame, the
 * fields, and opens the editor on it.
 */
function FrameBlockers({
  frames,
  fixable,
  onFix,
}: {
  frames: readonly ReviewFrame[];
  fixable: boolean;
  onFix: (assetId: string) => void;
}) {
  const blocked = frames.filter((frame) => frame.missingRequired.length > 0);
  if (blocked.length === 0) return null;

  return (
    <section aria-labelledby="blockers-heading" className={styles.blockers}>
      <h3 id="blockers-heading">
        {blocked.length} {blocked.length === 1 ? "frame needs" : "frames need"} work before this can
        be sent
      </h3>
      <ul>
        {blocked.map((frame) => (
          <li key={frame.assetId}>
            <span>
              <strong>{String(frame.position + 1).padStart(2, "0")}</strong>{" "}
              {frame.headline ?? frame.filename} — missing {frame.missingRequired.join(", ")}
            </span>
            {fixable ? (
              <button
                className={styles.fixInline}
                onClick={() => onFix(frame.assetId)}
                type="button"
              >
                Fix
              </button>
            ) : (
              <Link className="text-link" href={frame.assetHref}>
                Open
              </Link>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Everything the manifest table carried, kept whole. */
function FrameDetails({ frames }: { frames: readonly ReviewFrame[] }) {
  return (
    <div className={styles.detailsGrid}>
      {frames.map((frame) => (
        <article className={styles.detailCard} key={frame.assetId}>
          <div className={styles.detailHead}>
            <h3>
              {String(frame.position + 1).padStart(2, "0")} ·{" "}
              <Link className="text-link" href={frame.assetHref}>
                {frame.filename}
              </Link>
            </h3>
            <span className={styles.checkWord}>
              {frame.versionKind ? frame.versionKind : "Version missing"}
            </span>
          </div>

          <dl className={styles.detailPairs}>
            <div>
              <dt>Position</dt>
              <dd>{frame.position + 1}</dd>
            </div>
            <div>
              <dt>Checksum</dt>
              <dd>{frame.sha256 ? `${frame.sha256.slice(0, 12)}…` : "—"}</dd>
            </div>
            <div>
              <dt>Dimensions</dt>
              <dd>{frame.width && frame.height ? `${frame.width} × ${frame.height}` : "—"}</dd>
            </div>
            <div>
              <dt>File type</dt>
              <dd>{frame.mimeType ?? "—"}</dd>
            </div>
            <div>
              <dt>File size</dt>
              <dd>{bytesLabel(frame.bytes) ?? "—"}</dd>
            </div>
            <div>
              <dt>Captured</dt>
              <dd>{frame.capturedAt ? formatDateTime(frame.capturedAt) : "—"}</dd>
            </div>
            <div>
              <dt>Credit</dt>
              <dd>{frame.credit ?? "—"}</dd>
            </div>
            <div>
              <dt>Copyright</dt>
              <dd>{frame.copyright ?? "—"}</dd>
            </div>
            <div>
              <dt>Location</dt>
              <dd>{frame.location ?? "—"}</dd>
            </div>
            <div>
              <dt>Usage restrictions</dt>
              <dd>{frame.usageRestrictions ?? "—"}</dd>
            </div>
            <div>
              <dt>People</dt>
              <dd>{frame.people.length > 0 ? frame.people.join(", ") : "Not identified"}</dd>
            </div>
            <div>
              <dt>Caption source</dt>
              <dd>
                {frame.caption
                  ? frame.captionOrigin === "model"
                    ? frame.captionAwaitsReview
                      ? "Drafted by the caption writer, awaiting review"
                      : "Drafted by the caption writer, reviewed"
                    : "Written by a person"
                  : "No caption"}
              </dd>
            </div>
          </dl>

          <div>
            <dt className={styles.checkWord}>Full caption</dt>
            <p className={frame.caption ? undefined : styles.missing}>
              {frame.caption ?? "Caption missing"}
            </p>
          </div>

          {frame.missingRequired.length > 0 && (
            <p className={`${styles.gaps} ${styles.gapsBlocking}`}>
              Missing required: {frame.missingRequired.join(", ")}
            </p>
          )}
          {frame.missingRecommended.length > 0 && (
            <p className={styles.gaps}>
              Missing recommended: {frame.missingRecommended.join(", ")}
            </p>
          )}
        </article>
      ))}
    </div>
  );
}

/**
 * The desk's own reading of the package.
 *
 * Internal, and it says so. It shows the editorial fields a picture desk would
 * actually judge -- and it creates nothing, marks nothing, and cannot show a
 * recipient's watermark, because no recipient exists until a link does.
 */
function DeskPreview({
  frames,
  terms,
  restrictions,
}: {
  frames: readonly ReviewFrame[];
  terms?: string;
  restrictions?: string;
}) {
  return (
    <div className={styles.detailsGrid}>
      <p className={styles.note}>
        An internal rehearsal of what a picture desk would read. No recipient link exists yet, so
        nothing here has been created, shared, or watermarked for anybody.
      </p>
      {frames.map((frame) => (
        <article className={styles.detailCard} key={frame.assetId}>
          <div className={styles.detailHead}>
            <h3>{frame.headline ?? "Headline missing"}</h3>
            <span className={styles.checkWord}>{String(frame.position + 1).padStart(2, "0")}</span>
          </div>
          <p className={frame.caption ? undefined : styles.missing}>
            {frame.caption ?? "Caption missing"}
          </p>
          {frame.captionAwaitsReview && (
            <span className={styles.awaiting}>Caption awaiting review</span>
          )}
          <dl className={styles.detailPairs}>
            <div>
              <dt>People</dt>
              <dd>{frame.people.length > 0 ? frame.people.join(", ") : "Not identified"}</dd>
            </div>
            <div>
              <dt>Credit</dt>
              <dd>{frame.credit ?? "—"}</dd>
            </div>
            <div>
              <dt>Terms</dt>
              <dd>{terms ?? "Not recorded"}</dd>
            </div>
            <div>
              <dt>Restrictions</dt>
              <dd>{restrictions ?? "None recorded"}</dd>
            </div>
          </dl>
        </article>
      ))}
    </div>
  );
}

type View = "gallery" | "desk" | "details";

export function PackageGallery({
  frames,
  terms,
  restrictions,
  workspaceSlug,
  shootId,
  canEditFrames = false,
}: {
  frames: readonly ReviewFrame[];
  terms?: string;
  restrictions?: string;
  workspaceSlug: string;
  shootId: string;
  canEditFrames?: boolean;
}) {
  const [view, setView] = useState<View>("gallery");
  const [showAll, setShowAll] = useState(false);
  const [fixing, setFixing] = useState<string | null>(null);
  const restId = useId();

  /* Opening a fix from the summary has to reveal the frame even when it is one
     of the ones the +N control is hiding. */
  const openFix = (assetId: string) => {
    setView("gallery");
    setShowAll(true);
    setFixing(assetId);
  };

  const visible = showAll ? frames : frames.slice(0, ABOVE_THE_FOLD);
  const remaining = frames.length - ABOVE_THE_FOLD;

  return (
    <section aria-labelledby="gallery-heading">
      <div className={styles.galleryHead}>
        <h2 id="gallery-heading">What the desk will receive</h2>
        <div className={styles.viewToggles} role="group" aria-label="How to view this package">
          <button
            aria-pressed={view === "gallery"}
            className={`${styles.toggle} ${view === "gallery" ? styles.toggleOn : ""}`}
            onClick={() => setView("gallery")}
            type="button"
          >
            Gallery
          </button>
          <button
            aria-pressed={view === "desk"}
            className={`${styles.toggle} ${view === "desk" ? styles.toggleOn : ""}`}
            onClick={() => setView("desk")}
            type="button"
          >
            Desk preview
          </button>
          <button
            aria-pressed={view === "details"}
            className={`${styles.toggle} ${view === "details" ? styles.toggleOn : ""}`}
            onClick={() => setView("details")}
            type="button"
          >
            Frame details
          </button>
        </div>
      </div>

      {view === "gallery" && (
        <>
          <FrameBlockers frames={frames} fixable={canEditFrames} onFix={openFix} />

          <div className={`${styles.frames} ${styles.framesThree}`}>
            {visible.map((frame) => (
              <FrameCard
                frame={frame}
                fixable={canEditFrames}
                key={frame.assetId}
                onToggleFix={setFixing}
                open={fixing === frame.assetId}
                shootId={shootId}
                workspaceSlug={workspaceSlug}
              />
            ))}
          </div>

          {remaining > 0 && (
            <>
              <button
                aria-controls={restId}
                aria-expanded={showAll}
                className={styles.expander}
                onClick={() => setShowAll((open) => !open)}
                type="button"
              >
                <span className={styles.expanderCount}>{showAll ? "−" : `+${remaining}`}</span>
                <span className={styles.expanderCopy}>
                  <span>
                    {showAll
                      ? "Show the first three only"
                      : `+${remaining} ${remaining === 1 ? "frame" : "frames"}`}
                  </span>
                  <small>
                    Total {frames.length} {frames.length === 1 ? "frame" : "frames"}
                  </small>
                </span>
              </button>
              {/*
                Rendered but empty when collapsed, so the control it is labelled
                by always points at something real.
              */}
              <div id={restId} />
            </>
          )}
        </>
      )}

      {view === "desk" && <DeskPreview frames={frames} restrictions={restrictions} terms={terms} />}
      {view === "details" && <FrameDetails frames={frames} />}
    </section>
  );
}
