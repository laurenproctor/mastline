/**
 * Where to send somebody whose address did not name a workspace.
 *
 * This is the decision behind `landingWorkspace` in session-context.ts, kept
 * apart from it because that module is server-only: the cookie read and the
 * membership lookup need a request, and the choice made from their results does
 * not. Separating them is what makes the four outcomes testable.
 *
 * The rule the whole thing rests on: the hint is a preference, never an
 * authorization input. It is matched against memberships that have already been
 * filtered to this person, so a stale or forged value finds nothing and falls
 * through to the same place an absent one would.
 */

export interface LandingCandidate {
  readonly id: string;
  readonly slug: string;
}

export type LandingChoice<T extends LandingCandidate> =
  | { readonly outcome: "resolved"; readonly workspace: T }
  /** Several to choose between and nothing to choose on. Ask, do not guess. */
  | { readonly outcome: "ambiguous" }
  | { readonly outcome: "none" };

/**
 * @param workspaces The caller's active memberships, already filtered to them.
 * @param hintedId The active-workspace cookie's value, if there is one. A
 *   workspace id rather than a slug, so it survives a rename.
 */
export function chooseLandingWorkspace<T extends LandingCandidate>(
  workspaces: readonly T[],
  hintedId?: string | null,
): LandingChoice<T> {
  if (workspaces.length === 0) return { outcome: "none" };

  const hinted = hintedId ? workspaces.find((workspace) => workspace.id === hintedId) : undefined;
  if (hinted) return { outcome: "resolved", workspace: hinted };

  // One membership needs no hint: there is nothing to be wrong about.
  if (workspaces.length === 1) return { outcome: "resolved", workspace: workspaces[0] };

  return { outcome: "ambiguous" };
}
