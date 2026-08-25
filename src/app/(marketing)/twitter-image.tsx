/**
 * The same card again. Next emits og:image from opengraph-image and
 * twitter:image only from twitter-image, and a card X renders from its own tag
 * is one less thing depending on its Open Graph fallback.
 */
import { OG_ALT, OG_CONTENT_TYPE, OG_SIZE, socialCard } from "@/lib/og";

export const alt = OG_ALT;
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return socialCard();
}
