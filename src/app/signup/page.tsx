import { permanentRedirect } from "next/navigation";

/**
 * /signup was the address behind every "Start free" until the URLs were made to
 * read the way the screens do. It is linked from the live marketing site and
 * from anywhere else the link has been shared, so it redirects rather than
 * dead-ends.
 */
export default function LegacySignUp() {
  permanentRedirect("/sign-up");
}
