"use client";

/**
 * PROTOTYPE CONTROL. Delete with the prototype.
 *
 * Flips the phone navigation between the tile header that ships today and the
 * bottom tab bar being evaluated beside it, so the two can be compared on one
 * device rather than from two sets of screenshots.
 *
 * A cookie rather than component state, because the choice has to survive the
 * navigation you are trying to judge.
 */
export function NavPrototypeToggle({ mode }: { mode: "tiles" | "bottom" }) {
  const next = mode === "bottom" ? "tiles" : "bottom";

  return (
    <button
      className="nav-prototype-toggle"
      onClick={() => {
        document.cookie = `mastline_nav=${next}; path=/; max-age=604800; samesite=lax`;
        window.location.reload();
      }}
      type="button"
    >
      <span aria-hidden="true">⇄</span> Phone nav: {mode === "bottom" ? "bottom bar" : "tiles"}
    </button>
  );
}
