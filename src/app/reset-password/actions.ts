"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SITE_URL } from "@/lib/site";
import { hasRecoverySession } from "./recovery-session";

export interface ResetState {
  readonly sent?: boolean;
  readonly error?: string;
}

/**
 * Send a password reset link.
 *
 * Always reports success, whatever happened. Confirming which addresses have
 * accounts turns this form into a way to enumerate a customer list.
 */
export async function requestResetAction(
  _previous: ResetState,
  formData: FormData,
): Promise<ResetState> {
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  if (!email || !email.includes("@")) return { error: "Enter a valid email address." };

  const supabase = await createClient();

  /*
   * The destination comes from this deployment's own configuration, never from
   * the request.
   *
   * It used to be assembled from the Origin header, falling back to Host: both
   * are supplied by whoever is calling, so the address printed in somebody
   * else's password-reset email was an input to the form. What kept that from
   * being a full account takeover is a control that lives in Supabase rather
   * than here -- the auth server refuses a redirect that is not on the
   * project's allow list and quietly substitutes the site URL, which was
   * confirmed against the running stack: `https://evil.example.com/steal` came
   * back rewritten. Two things are still wrong with leaning on that. The allow
   * list is deliberately wide, carrying `https://mastline.co/**` and the
   * preview wildcards docs/DEPLOY.md records, so a spoofed Host can still steer
   * the link to another origin *within* it. And the property is enforced in a
   * dashboard setting, invisible from this file, one edit away from being
   * widened by somebody who does not know a reset email depends on it.
   *
   * SITE_URL is what the sitemap, robots.txt and the Open Graph tags already
   * resolve the canonical origin to: NEXT_PUBLIC_SITE_URL when set, the
   * per-deployment host on previews, the apex otherwise. It cannot be moved by
   * a header, so the emailed link is the same for every caller. It also has to
   * be: the code verifier is stored in cookies on the origin that asked for the
   * link, and a link returning to a different origin cannot be completed.
   */
  await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${SITE_URL}/auth/recovery`,
  });

  return { sent: true };
}

export interface UpdatePasswordState {
  readonly error?: string;
}

const MIN_PASSWORD = 10;

/**
 * Set a new password, then end every session.
 *
 * The session this runs under has to be one established by following a link
 * sent to the account's own mailbox -- not merely any session. `getUser()`
 * would have accepted anybody signed in, which is a different act with a
 * different screen for it; see recovery-session.ts.
 *
 * The sign-out is `global` on purpose, and the scope is the security policy
 * rather than an implementation detail. Somebody resetting a password may be
 * doing it because a password got out, and the sessions worth worrying about
 * are the ones already established with the old one -- possibly on a machine
 * that is not theirs. `others` would leave this browser signed in and look
 * tidier; it would also leave the person unable to tell whether the reset had
 * taken, and would keep alive a session minted from a link that has now done
 * its job. `local` would end the wrong one and leave the stolen sessions
 * running. So: every session everywhere, including this one, and the new
 * password gets used immediately at the sign-in screen. That the next step is
 * signing in is the point, not a rough edge.
 *
 * Which is also why success leaves by redirect rather than by returning a flag
 * for the form to render. Ending this session ends it for the re-render that
 * follows a Server Action too: the screen behind the form re-runs its own check
 * for a recovery session, correctly finds none, and sends the person to the
 * refusal notice -- so a password that had just been changed successfully
 * announced itself as a broken link. The confirmation has to live somewhere
 * that does not require the session this action deliberately destroyed.
 */
export async function updatePasswordAction(
  _previous: UpdatePasswordState,
  formData: FormData,
): Promise<UpdatePasswordState> {
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirmPassword") ?? "");

  if (password.length < MIN_PASSWORD) {
    return { error: `Use at least ${MIN_PASSWORD} characters.` };
  }
  if (password !== confirm) return { error: "Those passwords do not match." };

  const supabase = await createClient();

  if (!(await hasRecoverySession(supabase))) {
    return { error: "That reset link has expired. Request a new one." };
  }

  const { error } = await supabase.auth.updateUser({ password });

  if (error) {
    /*
     * One refusal is worth repeating rather than flattening.
     *
     * The auth server rejects a password identical to the current one, and
     * somebody who has landed here has usually forgotten which one that was.
     * Told only to "request a new link" they would spend the fresh link the
     * same way and get the same wall. This discloses nothing they did not just
     * type in. Every other failure stays generic.
     */
    if (/different from the old password/i.test(error.message)) {
      return { error: "Choose a password you have not used on this account before." };
    }
    return { error: "Could not update the password. Request a new link and try again." };
  }

  await supabase.auth.signOut({ scope: "global" });

  redirect("/reset-password?updated=1");
}
