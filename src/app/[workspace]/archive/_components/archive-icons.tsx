/**
 * The three glyphs the archive needs, drawn inline.
 *
 * The navigation's icon set is a shared component under change elsewhere, and
 * none of these three belong in it: they are not destinations. Stroke-only, at
 * the weight of the interface type, so they read as marks rather than art.
 */

const SHARED = {
  "aria-hidden": true as const,
  fill: "none",
  focusable: false,
  height: 18,
  stroke: "currentColor",
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  strokeWidth: 1.75,
  viewBox: "0 0 24 24",
  width: 18,
};

export function SearchIcon() {
  return (
    <svg {...SHARED} width={20} height={20}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.8-3.8" />
    </svg>
  );
}

export function GridIcon() {
  return (
    <svg {...SHARED}>
      <rect x="4" y="4" width="7" height="7" />
      <rect x="13" y="4" width="7" height="7" />
      <rect x="4" y="13" width="7" height="7" />
      <rect x="13" y="13" width="7" height="7" />
    </svg>
  );
}

export function ListIcon() {
  return (
    <svg {...SHARED}>
      <path d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  );
}
