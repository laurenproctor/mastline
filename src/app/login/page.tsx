import { permanentRedirect } from "next/navigation";

/**
 * /login was the sign-in address until the URLs were made to read the way the
 * screens do. Bookmarks, password managers and anything already linking here
 * should land on the real screen rather than a dead end, and the ?next= they
 * were carrying has to survive the move or somebody is sent to the wrong place
 * after signing in.
 */
export default async function LegacyLogin({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  permanentRedirect(next ? `/sign-in?next=${encodeURIComponent(next)}` : "/sign-in");
}
