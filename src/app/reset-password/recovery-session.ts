import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Was this session established by following a recovery link?
 *
 * A recovery link produces an ordinary, fully privileged session -- that is how
 * Supabase password recovery works -- so "is somebody signed in?" is not the
 * question worth asking before letting a password be replaced. Someone signed
 * in with a password they already know is not recovering anything, and the
 * screen that answers this flow says so in as many words.
 *
 * The distinguishing fact is the `amr` claim: the auth server records how the
 * session was proved and stamps `recovery` on the ones that came from a link
 * sent to the mailbox. It is minted and signed by the auth server, so unlike a
 * cookie this application sets for itself it cannot be forged by the browser
 * holding it.
 *
 * `getClaims()` rather than a hand-rolled decode, because reading a JWT is not
 * the same as trusting one. With asymmetric signing keys it verifies the
 * signature against the project's published JWKS; with a symmetric secret --
 * which is what a local stack and any project predating signing keys uses -- it
 * falls back to `getUser()`, which revalidates the token against the auth
 * server before the claims are believed. Either way the claims have been
 * checked by the time they are returned. `getSession()` would not do: it
 * reports whatever the cookie says.
 *
 * The RFC-8176 string form is accepted alongside the object form because the
 * installed types permit both (`amr?: AMREntry[] | string[]`), and a guard that
 * silently returns false against a shape the library allows would fail open in
 * the direction of locking a legitimate person out.
 */
export async function hasRecoverySession(supabase: SupabaseClient): Promise<boolean> {
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data) return false;

  const amr = data.claims.amr;
  if (!Array.isArray(amr)) return false;

  return amr.some((entry) => (typeof entry === "string" ? entry : entry?.method) === "recovery");
}
