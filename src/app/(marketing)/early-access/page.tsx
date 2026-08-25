import { permanentRedirect } from "next/navigation";

/**
 * The design artifact captured early access as a form that posted to a mailto:
 * address. Real sign-up exists and works: it creates the account, then hands
 * over to onboarding, which creates the workspace on the approved trial terms.
 *
 * Sending a "Start free" click to a mail client instead of that flow loses the
 * person and the account, so everything points at /signup and this address
 * redirects rather than dead-ends.
 *
 * The qualifying questions the form asked -- market, how you work, what slows
 * you down -- are not captured anywhere yet. They belong in onboarding, after
 * there is an account to attach them to.
 */
export default function EarlyAccess() {
  permanentRedirect("/sign-up");
}
