import { Children, isValidElement, type ReactNode } from "react";
import { ActionLink, Button, IconButton, PendingButton, TextLink } from "@/components/button";
import { FilterChip, FilterLink } from "@/components/filter-chip";
import { TabLink } from "@/components/tabs";

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

/**
 * The design system's own controls, compared by reference. Never by name: a
 * production build minifies function names, so a check on `type.name` would
 * pass in development and silently stop working in the build that ships.
 */
const INTERACTIVE_COMPONENTS: ReadonlySet<unknown> = new Set<unknown>([
  Button,
  IconButton,
  PendingButton,
  ActionLink,
  TextLink,
  TabLink,
  FilterChip,
  FilterLink,
]);

function elementIsInteractive(type: unknown, props: Record<string, unknown>): boolean {
  if (typeof type === "string") {
    if (INTERACTIVE_TAGS.has(type)) return true;
    return typeof props.tabIndex === "number" && props.tabIndex >= 0;
  }
  if (INTERACTIVE_COMPONENTS.has(type)) return true;
  // Any component handed an href is a link however it is named: a Next Link,
  // or one of the application's own.
  return typeof props.href === "string";
}

/**
 * Throw if `node` contains an interactive control, at any depth of the
 * element tree that is visible from here.
 *
 * Visible means the elements passed in and their `children` props. What a
 * child component renders is not known until it renders, so a control hidden
 * inside some other component's output is not seen. This guard catches the
 * obvious mistake -- a Button, a Link, or a raw anchor handed to a CardLink
 * -- and the contract it enforces is the caller's responsibility beyond
 * that: nothing interactive, at any depth, inside a linked surface.
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
