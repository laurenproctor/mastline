"use client";

import { CONSENT_REOPEN_EVENT } from "./consent-banner";

/**
 * The way back to the choice.
 *
 * It sits in the footer's Legal list and is styled by that list, not by the
 * banner, so it reads as one of the links beside it rather than a control.
 *
 * Rendered for every visitor, including those who never saw the banner: it
 * costs a line, and a visitor who has moved between countries or cleared their
 * cookies should still be able to find it.
 */
export function ConsentReopenLink() {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event(CONSENT_REOPEN_EVENT))}
      style={{
        font: "inherit",
        color: "inherit",
        background: "none",
        border: 0,
        padding: 0,
        cursor: "pointer",
        textAlign: "left",
      }}
    >
      Cookie choices
    </button>
  );
}
