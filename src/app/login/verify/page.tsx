import { permanentRedirect } from "next/navigation";

/** The two-factor step moved with the screen it belongs to. */
export default async function LegacyVerify({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  permanentRedirect(next ? `/sign-in/verify?next=${encodeURIComponent(next)}` : "/sign-in/verify");
}
