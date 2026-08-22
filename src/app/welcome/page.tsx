import { permanentRedirect } from "next/navigation";

/**
 * /welcome was the marketing home before the site existed as a site. Anything
 * already pointing here -- a bookmark, a link in an email, an old test -- should
 * land on the real home page rather than a dead end.
 */
export default function Welcome() {
  permanentRedirect("/");
}
