/**
 * Navigation icons, drawn.
 *
 * These were Unicode glyphs -- ⌂ ◉ ▣ ➤ $ © □ -- which every platform renders at
 * a different weight, size and baseline, so the column read as seven unrelated
 * marks. One 18px grid, one stroke width, currentColor throughout.
 *
 * They live in their own module because two shells draw them: the sidebar, and
 * the phone tab bar prototype beside it. Keeping them in app-shell.tsx and
 * importing from there would have made the two import each other.
 */
const ICONS = {
  work: "M3 8.5 9 3.5l6 5V15a.5.5 0 0 1-.5.5h-3v-4h-5v4h-3A.5.5 0 0 1 3 15z",
  news: "M4.5 5.5h9v7h-9zM6.5 8h5M6.5 10h3",
  shoots: "M2.5 6h13v8.5h-13zM6 6l1.2-2h3.6L12 6M9 12.2a2.4 2.4 0 1 0 0-4.8 2.4 2.4 0 0 0 0 4.8",
  submissions: "M15 3.5 8 10M15 3.5l-4.4 11.6-2.2-5-5-2.2z",
  money:
    "M9 3v12M11.8 5.6c-.6-.7-1.6-1.1-2.8-1.1-1.7 0-2.8.8-2.8 2s1 1.8 2.8 2.1c1.9.4 3 1 3 2.2s-1.2 2.1-3 2.1c-1.3 0-2.4-.4-3-1.2",
  rights:
    "M9 2.5a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13M11.2 7.2A2.6 2.6 0 0 0 9 6.1a2.9 2.9 0 0 0 0 5.8 2.6 2.6 0 0 0 2.2-1.1",
  commercial:
    "M9.6 2.6H15.4v5.8l-6.6 6.6a1.1 1.1 0 0 1-1.6 0L2.6 10.2a1.1 1.1 0 0 1 0-1.6zM12.8 5.9a.85.85 0 1 1-1.7 0 .85.85 0 0 1 1.7 0",
  archive: "M2.5 4h13v3h-13zM4 7v7.5h10V7M7 10h4",
  settings:
    "M9 6.6a2.4 2.4 0 1 0 0 4.8 2.4 2.4 0 0 0 0-4.8M9 2.5l.5 1.8 1.8.5 1.5-1.1 1.5 1.5-1.1 1.5.5 1.8 1.8.5v2.1l-1.8.5-.5 1.8 1.1 1.5-1.5 1.5-1.5-1.1-1.8.5-.5 1.8H7.9l-.5-1.8-1.8-.5-1.5 1.1-1.5-1.5 1.1-1.5-.5-1.8-1.8-.5V9.6l1.8-.5.5-1.8L2.6 5.8l1.5-1.5 1.5 1.1 1.8-.5.5-1.8z",
} as const;

export type IconName = keyof typeof ICONS;

export function NavIcon({ name }: { name: IconName }) {
  return (
    <svg
      aria-hidden="true"
      className="nav-icon"
      fill="none"
      height="18"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.35"
      viewBox="0 0 18 18"
      width="18"
    >
      <path d={ICONS[name]} />
    </svg>
  );
}
