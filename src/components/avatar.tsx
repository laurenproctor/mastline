/**
 * A person, as a circle.
 *
 * The initials are not a placeholder waiting for a photo; they are the resting
 * state. Most people never set one, and a workspace of grey silhouettes reads
 * worse than a workspace of letters.
 *
 * Not next/image: the source is a signed URL against a private bucket with a
 * short expiry, so it cannot be optimised into a cache that outlives the
 * signature.
 */
export function Avatar({
  initials,
  url,
  name,
}: {
  initials: string;
  url?: string;
  /** Used only for alt text. Omitted entirely when the circle is decorative. */
  name?: string;
}) {
  if (url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        alt={name ? `${name}'s photo` : ""}
        aria-hidden={name ? undefined : "true"}
        className="avatar"
        height={34}
        src={url}
        width={34}
      />
    );
  }

  return (
    <span aria-hidden="true" className="avatar">
      {initials}
    </span>
  );
}
