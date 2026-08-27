"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Copy, for the press kit.
 *
 * The Press page hands a reporter approved boilerplate, fast facts, and brand
 * hex values, and then asked them to select the text by hand -- which for the
 * one-paragraph boilerplate means dragging across ninety words and hoping the
 * selection did not pick up the heading. This is the interaction that page
 * actually wants, and the only one on the site with a job rather than an
 * argument to make.
 *
 * `navigator.clipboard` needs a secure context, so it is absent over plain
 * http on anything but localhost. Rather than a button that silently does
 * nothing, the failure is said out loud and the text stays selectable.
 */
export function CopyButton({
  label = "Copy",
  text,
  value,
}: {
  /** What the control says before it is used. */
  label?: string;
  /** What lands on the clipboard. */
  text: string;
  /** Shown beside the control, when the value is short enough to show. */
  value?: string;
}) {
  const [state, setState] = useState<"idle" | "done" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = useCallback(async () => {
    clearTimeout(timer.current);
    try {
      await navigator.clipboard.writeText(text);
      setState("done");
    } catch {
      setState("failed");
    }
    timer.current = setTimeout(() => setState("idle"), 2400);
  }, [text]);

  return (
    <span className="copy">
      {value && <code>{value}</code>}
      {/* The label swaps in place and the button is its own live region, so the
          outcome is announced once rather than sitting silently next to a
          control that still says "Copy". */}
      <button aria-live="polite" className={state} onClick={copy} type="button">
        {state === "done" ? "Copied" : state === "failed" ? "Select and copy" : label}
      </button>
    </span>
  );
}
