/**
 * A status, as a short word in a pill.
 *
 * The badge's colour reinforces the word; it never replaces it, which is why
 * `children` is the one required prop and there is no icon-only form.
 */

/** The semantic tones the stylesheet draws, by meaning rather than by hue. */
export type BadgeTone = "neutral" | "success" | "warning" | "danger" | "info" | "highlight";

/**
 * The tone names the application has used since the scaffold.
 *
 * Kept as an alias so twenty-six files, and the lookup tables in them, keep
 * compiling untouched; each one maps onto a semantic tone here. New code
 * should name the meaning (`success`) rather than the colour (`blue`).
 */
export type Tone = "neutral" | "good" | "warn" | "danger" | "blue";

const LEGACY_TONE: Record<Tone, BadgeTone> = {
  neutral: "neutral",
  good: "success",
  warn: "warning",
  danger: "danger",
  blue: "info",
};

const SEMANTIC_TONES: ReadonlySet<string> = new Set<BadgeTone>([
  "neutral",
  "success",
  "warning",
  "danger",
  "info",
  "highlight",
]);

/** Resolve either vocabulary to the tone the stylesheet understands. */
export function badgeTone(tone: Tone | BadgeTone | undefined): BadgeTone {
  if (!tone) return "neutral";
  if (SEMANTIC_TONES.has(tone)) return tone as BadgeTone;
  return LEGACY_TONE[tone as Tone] ?? "neutral";
}

export function Badge({
  children,
  tone = "neutral",
  className,
}: {
  children: React.ReactNode;
  tone?: Tone | BadgeTone;
  className?: string;
}) {
  return (
    <span className={className ? `ml-badge ${className}` : "ml-badge"} data-tone={badgeTone(tone)}>
      {children}
    </span>
  );
}
