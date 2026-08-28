"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { submitRequestLink } from "@/lib/data/request-intake";
import { intakeFailureMessage, isIntakeToken, parseIntake } from "@/lib/request-intake";

export interface IntakeState {
  readonly error?: string;
  readonly field?: string;
}

/**
 * A desk sending one request into a photographer's workspace.
 *
 * The only write anyone without an account can perform here, and it can happen
 * once per link. Everything that decides WHERE it lands -- the workspace, the
 * buyer -- is read from the link row inside the database function, so nothing
 * in this FormData can redirect a request anywhere.
 *
 * Cross-site protection is Next's, not ours: a Server Action is a POST to an
 * action id with an Origin check, so a third-party page cannot invoke this on a
 * visitor's behalf. Adding a token of our own would be a second, worse copy of
 * a mechanism the framework already applies.
 *
 * Refusals stay vague on purpose. A stranger holding a bad link learns that it
 * does not work and nothing else -- not whether it ever existed, not whether it
 * expired, not whose it was.
 */
export async function submitIntakeAction(
  _previous: IntakeState,
  formData: FormData,
): Promise<IntakeState> {
  const token = String(formData.get("token") ?? "");
  if (!isIntakeToken(token)) return { error: "This link is not open." };

  const raw: Record<string, unknown> = {};
  for (const [key, value] of formData.entries()) {
    if (key === "token") continue;
    if (typeof value === "string") raw[key] = value;
  }
  raw.requestedFormats = formData.getAll("requestedFormats").filter((f) => typeof f === "string");

  const parsed = parseIntake(raw);
  if (!parsed.ok || !parsed.value) {
    return {
      error: parsed.failure ? intakeFailureMessage(parsed.failure) : "That could not be sent.",
      field: parsed.field,
    };
  }

  const result = await submitRequestLink(token, parsed.value, await headers());

  if (result.status === "rate_limited") {
    return { error: "Too many attempts from this connection. Wait a few minutes and try again." };
  }
  if (result.status === "invalid") {
    return { error: "This link is not open." };
  }

  // Post-redirect-get onto the same address, which now renders the
  // confirmation because the link records a submission.
  redirect(`/r/${token}`);
}
