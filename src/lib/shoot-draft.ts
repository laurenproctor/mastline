/**
 * What the final review on the shoot-creation page says.
 *
 * Creating a shoot is private, reversible workspace activity, so this review is
 * not a gate. It exists because the photographer is about to stop looking at
 * the form, and because the things that will block a DISPATCH later are cheaper
 * to fix now, while the frames are still in front of them.
 *
 * The distinction the whole module turns on:
 *
 *   - blocking  -- this draft cannot be written at all
 *   - warnings  -- this draft is fine; something downstream is not yet
 *
 * Only two things block. A shoot needs a subject or event, because a record
 * nobody can find again is not a record. And a file still moving cannot be
 * registered against a shoot that does not exist yet, so submitting mid-upload
 * would silently drop it. Everything else -- a missing caption, no credit line,
 * no copyright notice -- is a warning here and a hard requirement at the
 * dispatch gate, which is where it belongs: those are what a picture desk
 * rejects work for, not what a photographer needs before they can save a note
 * to themselves.
 *
 * The rules are the same ones BASELINE_RULES states in metadata-rules.ts, read
 * from the draft rather than from stored assets. Both must agree, so the
 * warnings here name the same fields the dispatch review will block on.
 */

/** A photograph on the creation page, at whatever stage it has reached. */
export interface DraftPhotograph {
  readonly id: string;
  readonly filename: string;
  readonly bytes: number;
  /** "staged" is ready to be created; anything else is not yet, or never. */
  readonly state: "queued" | "hashing" | "uploading" | "staged" | "failed";
  readonly capturedAt?: string;
  readonly headline?: string;
  readonly caption?: string;
  readonly subjects?: readonly string[];
  readonly keywords?: readonly string[];
  readonly locationName?: string;
}

export interface DraftInput {
  readonly title: string;
  readonly creditLine?: string;
  readonly copyrightNotice?: string;
  readonly locationName?: string;
  readonly embargoUntil?: string;
  readonly exclusivity?: string;
  readonly sensitiveContent: boolean;
  readonly photographs: readonly DraftPhotograph[];
}

export interface DraftNote {
  /** Stable, so a test and a scroll target can both name one. */
  readonly id: string;
  readonly text: string;
  /** Which section of the page fixes it. Used for the anchor. */
  readonly section: "details" | "photographs" | "metadata" | "rights";
}

export interface DraftReview {
  /** Photographs that will be registered if Create shoot is pressed now. */
  readonly readyCount: number;
  /** Still hashing or uploading. Pressing Create shoot now would lose these. */
  readonly pendingCount: number;
  readonly failedCount: number;
  readonly totalBytes: number;
  /** Stops the draft being written. Empty means Create shoot is available. */
  readonly blocking: readonly DraftNote[];
  /** Does not stop anything. Named because dispatch will ask for them. */
  readonly warnings: readonly DraftNote[];
  readonly canCreate: boolean;
}

const has = (value: string | undefined | null): boolean =>
  typeof value === "string" && value.trim().length > 0;

const PENDING_STATES = new Set<DraftPhotograph["state"]>(["queued", "hashing", "uploading"]);

/**
 * The photographs a Create shoot would actually carry.
 *
 * Generic over the row type so the creation page gets its own richer rows back
 * -- with the staged digest and the preview still attached -- rather than
 * having them narrowed away and cast back.
 */
export function stagedPhotographs<T extends DraftPhotograph>(
  photographs: readonly T[],
): readonly T[] {
  return photographs.filter((photograph) => photograph.state === "staged");
}

export function reviewDraft(input: DraftInput): DraftReview {
  const ready = stagedPhotographs(input.photographs);
  const pending = input.photographs.filter((photograph) => PENDING_STATES.has(photograph.state));
  const failed = input.photographs.filter((photograph) => photograph.state === "failed");

  const blocking: DraftNote[] = [];
  const warnings: DraftNote[] = [];

  if (!has(input.title)) {
    blocking.push({
      id: "title",
      section: "details",
      text: "Give the shoot a subject or event.",
    });
  }

  if (pending.length > 0) {
    blocking.push({
      id: "uploads-in-flight",
      section: "photographs",
      text:
        pending.length === 1
          ? "One photograph is still uploading. It would not be saved yet."
          : `${pending.length} photographs are still uploading. They would not be saved yet.`,
    });
  }

  if (failed.length > 0) {
    warnings.push({
      id: "uploads-failed",
      section: "photographs",
      text: `${failed.length} ${failed.length === 1 ? "photograph" : "photographs"} failed to upload and will not be saved. Add ${failed.length === 1 ? "it" : "them"} again from the shoot.`,
    });
  }

  if (ready.length > 0) {
    const withoutCaption = ready.filter((photograph) => !has(photograph.caption));
    if (withoutCaption.length > 0) {
      warnings.push({
        id: "missing-caption",
        section: "photographs",
        text: `${withoutCaption.length} of ${ready.length} ${ready.length === 1 ? "photograph has" : "photographs have"} no caption. A caption is required before dispatch, not before saving.`,
      });
    }

    const withoutCaptureTime = ready.filter((photograph) => !has(photograph.capturedAt));
    if (withoutCaptureTime.length > 0) {
      warnings.push({
        id: "missing-capture-time",
        section: "photographs",
        text: `${withoutCaptureTime.length} ${withoutCaptureTime.length === 1 ? "photograph carries" : "photographs carry"} no capture time in the file. Dispatch asks for one.`,
      });
    }

    if (!has(input.creditLine)) {
      warnings.push({
        id: "missing-credit",
        section: "metadata",
        text: "No credit line. Every frame inherits it, and dispatch requires one.",
      });
    }

    if (!has(input.copyrightNotice)) {
      warnings.push({
        id: "missing-copyright",
        section: "metadata",
        text: "No copyright notice. Every frame inherits it, and dispatch requires one.",
      });
    }
  }

  if (has(input.embargoUntil)) {
    warnings.push({
      id: "embargo",
      section: "rights",
      text: "An embargo is recorded on this shoot. The dispatch review will check it before anything is sent.",
    });
  }

  if (has(input.exclusivity)) {
    warnings.push({
      id: "exclusivity",
      section: "rights",
      text: "An exclusivity is recorded on this shoot. It travels with every package built from it.",
    });
  }

  if (input.sensitiveContent) {
    warnings.push({
      id: "sensitive",
      section: "rights",
      text: "Marked as sensitive content. Frames stay private and the dispatch review will say so.",
    });
  }

  return {
    readyCount: ready.length,
    pendingCount: pending.length,
    failedCount: failed.length,
    totalBytes: ready.reduce((sum, photograph) => sum + photograph.bytes, 0),
    blocking,
    warnings,
    canCreate: blocking.length === 0,
  };
}
