import { requireSession } from "../auth";
import { createClient } from "../supabase/server";

/**
 * How many unused recovery codes an account has left.
 *
 * A plain server function rather than an action: this is read while the
 * settings page renders, and a Server Action cannot be called during a render.
 * Only the count is ever returned -- the codes themselves are readable once, at
 * the moment they are made, and are stored only as hashes.
 */
export async function countRecoveryCodes(): Promise<number> {
  const session = await requireSession();
  const supabase = await createClient();

  const { count } = await supabase
    .from("mfa_recovery_codes")
    .select("id", { count: "exact", head: true })
    .eq("user_id", session.userId)
    .is("used_at", null);

  return count ?? 0;
}
