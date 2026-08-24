import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { isDeliveryToken } from "@/lib/delivery";
import { openDelivery } from "@/lib/data/delivery-links";
import { formatDateTime } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { signedUrlsFor } from "@/lib/data/imports";

export const metadata = { title: "A package from Mastline" };
export const dynamic = "force-dynamic";

/**
 * What a picture desk sees.
 *
 * No account, no password, no software: the link is the whole of it, which is
 * the promise the marketing site makes to editors and the gap docs/DECISIONS.md
 * records -- a dispatch was recorded but never transmitted.
 *
 * Everything on this page arrives through a security-definer function keyed on
 * the token. There is no session, so there is nothing for row level security to
 * decide, and nothing here can reach an original, a source note, a price, or
 * another workspace.
 *
 * An unknown token, a withdrawn link, and an expired one all render the same
 * page. Telling a stranger which it was tells them something about a link they
 * do not hold.
 */
export default async function DeliveryPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!isDeliveryToken(token)) notFound();

  const delivery = await openDelivery(token, await headers());
  if (!delivery) {
    return (
      <main className="auth-page">
        <div className="auth-card">
          <h1>This link is not open</h1>
          <p className="section-note">
            It may have been withdrawn, or it may have run out. Ask whoever sent it for a new one.
          </p>
        </div>
      </main>
    );
  }

  const previewKeys = delivery.assets
    .map((asset) => asset.previewKey)
    .filter((key): key is string => Boolean(key));
  const previews = await signedUrlsFor(await createClient(), "derivatives", previewKeys, 900);

  return (
    <main className="delivery-page">
      <header className="delivery-head">
        <p className="eyebrow">A package for review</p>
        <h1>{delivery.packageName}</h1>
        {delivery.creditLine && <p className="section-note">{delivery.creditLine}</p>}
        <p className="section-note">
          {delivery.assets.length} {delivery.assets.length === 1 ? "frame" : "frames"} · this link
          closes {formatDateTime(delivery.expiresAt)}
        </p>
      </header>

      {(delivery.terms || delivery.restrictions || delivery.embargoUntil) && (
        <section className="delivery-terms">
          <h2>Terms</h2>
          {delivery.embargoUntil && (
            <p className="section-note">
              <strong>Embargoed until {formatDateTime(delivery.embargoUntil)}.</strong>
            </p>
          )}
          {delivery.terms && <p className="section-note">{delivery.terms}</p>}
          {delivery.restrictions && <p className="section-note">{delivery.restrictions}</p>}
        </section>
      )}

      <section className="delivery-frames">
        {delivery.assets.map((asset) => (
          <article className="delivery-frame" key={asset.assetId}>
            {asset.previewKey && previews.get(asset.previewKey) ? (
              /* A signed, short-lived URL from private storage. next/image
                 would proxy and cache a file that is deliberately neither
                 public nor durable. */
              // eslint-disable-next-line @next/next/no-img-element
              <img alt={asset.headline ?? asset.filename} src={previews.get(asset.previewKey)} />
            ) : (
              <div className="delivery-frame-blank">No preview</div>
            )}
            <div className="delivery-frame-body">
              <h3>{asset.headline ?? asset.filename}</h3>
              {asset.caption && <p className="section-note">{asset.caption}</p>}
              {asset.capturedAt && (
                <p className="section-note">{formatDateTime(asset.capturedAt)}</p>
              )}
              <a className="button small blue" href={`/d/${token}/frame/${asset.assetId}`}>
                Download full resolution
              </a>
            </div>
          </article>
        ))}
      </section>

      <footer className="delivery-foot">
        <p className="section-note">
          Downloads from this link are recorded, with the time and the address they came from, and
          shown to the photographer.
        </p>
      </footer>
    </main>
  );
}
