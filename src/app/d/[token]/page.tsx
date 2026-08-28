import { cookies, headers } from "next/headers";
import { notFound } from "next/navigation";
import { CONSENT_COOKIE, COUNTRY_COOKIE, mayCollectOptionalAnalytics } from "@/lib/consent";
import { isDeliveryToken } from "@/lib/delivery";
import { openDelivery } from "@/lib/data/delivery-links";
import { formatDateTime } from "@/lib/format";
import { AcceptTerms } from "./_components/accept-terms";
import { ViewingTracker } from "./_components/viewing-tracker";

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

  /*
   * Two kinds of collection sit on this page and they are not the same thing.
   *
   * The open above, the acceptance below, and any download are commercial
   * evidence -- the photographer's record of what a buyer did with their work.
   * They happen regardless of what follows.
   *
   * How long the page was actually looked at, and which frames, is engagement
   * measurement. It is useful and it is not necessary to operate the delivery,
   * so it sits behind the same choice as everything else optional, and where a
   * choice is required and has not been made, the tracker is simply not
   * rendered. The photographer's screen shows that as "viewing time
   * unavailable", never as zero engagement.
   */
  const jar = await cookies();
  const analyticsAllowed = mayCollectOptionalAnalytics({
    choice: jar.get(CONSENT_COOKIE)?.value,
    country: jar.get(COUNTRY_COOKIE)?.value,
  });

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

          {delivery.acceptedAt ? (
            <p className="delivery-accepted" role="status">
              Accepted by {delivery.acceptedBy} on {formatDateTime(delivery.acceptedAt)}.
            </p>
          ) : (
            <AcceptTerms token={token} />
          )}
        </section>
      )}

      <section className="delivery-frames">
        {delivery.assets.map((asset) => (
          <article className="delivery-frame" data-asset-id={asset.assetId} key={asset.assetId}>
            {asset.previewKey ? (
              /* Served through the route so the only version a recipient can
                 reach carries their name. A signed URL here would hand over the
                 clean file. next/image would proxy and cache something that is
                 deliberately neither public nor durable. */
              // eslint-disable-next-line @next/next/no-img-element
              <img
                alt={asset.headline ?? asset.filename}
                src={`/d/${token}/preview/${asset.assetId}`}
              />
            ) : (
              <div className="delivery-frame-blank">No preview</div>
            )}
            <div className="delivery-frame-body">
              <h3>{asset.headline ?? asset.filename}</h3>
              {asset.caption && <p className="section-note">{asset.caption}</p>}
              {asset.capturedAt && (
                <p className="section-note">{formatDateTime(asset.capturedAt)}</p>
              )}
              {delivery.acceptedAt ? (
                <a className="button small blue" href={`/d/${token}/frame/${asset.assetId}`}>
                  Download full resolution
                </a>
              ) : (
                <p className="section-note">
                  Accept the terms above to download the full-resolution file.
                </p>
              )}
            </div>
          </article>
        ))}
      </section>

      <footer className="delivery-foot">
        <p className="section-note">
          Opening this link, accepting the terms, and downloading a file are recorded with the time
          and the address they came from, and shown to the photographer as the delivery record for
          this package.
        </p>
        {analyticsAllowed ? (
          <p className="section-note">
            While this page is open and in front of you, Mastline also measures roughly how long it
            is on screen and which photographs you look at, so the photographer can see which frames
            drew attention. Time is not counted while the tab is hidden or idle. This is first-party
            measurement only: there is no advertising, no third-party tracker, no session recording,
            and nothing is collected about your browsing anywhere else.
          </p>
        ) : (
          <p className="section-note">
            Viewing-time measurement is off for this visit, so only the delivery record above is
            kept.
          </p>
        )}
      </footer>
      {analyticsAllowed && <ViewingTracker token={token} />}
    </main>
  );
}
