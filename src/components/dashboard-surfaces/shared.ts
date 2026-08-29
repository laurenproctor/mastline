import { Children, isValidElement, type ReactNode } from "react";

/**
 * What the surface primitives have in common.
 *
 * A finite tone vocabulary, so a caller names a meaning and the stylesheet
 * decides the colour; a heading level, so a surface can sit under whatever
 * heading the page already has; and a check that a linked surface is not
 * wrapped around another control.
 */

/** The semantic tones a surface may carry. Meaning, never a colour. */
export type SurfaceTone = "neutral" | "info" | "success" | "warning" | "danger";

export const SURFACE_TONES: readonly SurfaceTone[] = [
  "neutral",
  "info",
  "success",
  "warning",
  "danger",
];

export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

/** Join the classes that are present, in the order given. */
export function classes(...names: Array<string | false | null | undefined>): string {
  return names.filter(Boolean).join(" ");
}

/**
 * Element types that are, or render, an interactive control. A linked card
 * or a row action may not contain one of these: nested links and buttons are
 * invalid HTML, and the browser makes an arbitrary choice about which one a
 * click or an Enter reaches.
 */
const INTERACTIVE_TAGS = new Set(["a", "button", "input", "select", "textarea", "details"]);

function elementIsInteractive(type: unknown, props: Record<string, unknown>): boolean {
  if (typeof type === "string") {
    if (INTERACTIVE_TAGS.has(type)) return true;
    return typeof props.tabIndex === "number" && props.tabIndex >= 0;
  }
  // A component that carries an href is a link however it is named -- a Next
  // Link, an ActionLink, a TextLink, a TabLink.
  if (typeof type === "function" || (typeof type === "object" && type !== null)) {
    if (typeof props.href === "string") return true;
    const name =
      (type as { displayName?: string; name?: string }).displayName ??
      (type as { name?: string }).name;
    return (
      name === "Button" ||
      name === "IconButton" ||
      name === "PendingButton" ||
      name === "FilterChip"
    );
  }
  return false;
}

/**
 * Throw if `node` contains an interactive control, at any depth of the
 * element tree that is visible from here.
 *
 * Visible means the props of the elements passed in: a child component's own
 * output is not rendered yet and cannot be inspected, so this is a guard
 * against the obvious mistake -- a Button inside a CardLink -- not a proof.
 */
export function assertNoInteractiveChildren(node: ReactNode, where: string): void {
  Children.forEach(node, (child) => {
    if (!isValidElement(child)) return;
    const props = (child.props ?? {}) as Record<string, unknown>;
    if (elementIsInteractive(child.type, props)) {
      const what = typeof child.type === "string" ? `<${child.type}>` : "a link or button";
      throw new Error(
        `${where} is itself the interactive target and cannot contain ${what}. ` +
          "Put the control beside the surface, not inside it.",
      );
    }
    if (props.children !== undefined) {
      assertNoInteractiveChildren(props.children as ReactNode, where);
    }
  });
}
