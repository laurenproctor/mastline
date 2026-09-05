import { cookies, headers } from "next/headers";
import { notFound } from "next/navigation";
import { CONSENT_COOKIE, COUNTRY_COOKIE, mayCollectOptionalAnalytics } from "@/lib/consent";
import { isDeliveryToken } from "@/lib/delivery";
import { openDelivery } from "@/lib/data/delivery-links";
import { formatDate, formatDateTime } from "@/lib/format";
import { AcceptTerms } from "./_components/accept-terms";
import { DeliveryGallery } from "./_components/delivery-gallery";
import { DeliveryGate } from "./_components/delivery-gate";
import { ViewingTracker } from "./_components/viewing-tracker";

export const metadata = { title: "A package from Mastline" };
export const dynamic = "force-dynamic";

/**
 * What a picture desk sees: a private editorial delivery, not an
 * administrative page.
 *
 * No account, no password, no software: the link is the whole of it.
 * Everything here arrives through a security-definer function keyed on the
 * token. There is no session, so there is nothing for row level security to
 * decide, and nothing here can reach an original, a source note, a price, or
 * another workspace.
 *
 * Two shapes, decided by the link's own options:
 *
 *   With the acceptance gate on and no acceptance yet, the page is the front
 *   door — the name, the terms, and one button. The database returns no
 *   frames for a gated link until the yes exists, so the photographs are not
 *   merely hidden by this page; they are not here.
 *
 *   Otherwise it is the gallery: one photograph at a time with its headline,
 *   caption, and people, arrow keys to browse, and the downloads exactly as
 *   gated as they always were.
 *
 * An unknown token, a withdrawn link, and an expired one all render the same
 * page. Telling a stranger which it was tells them something about a link
 * they do not hold.
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

  const accepted = Boolean(delivery.acceptedAt);
  const gated = delivery.requireAcceptanceToView && !accepted;
  const count = delivery.assetCount;
  const countWord = count === 1 ? "photograph" : "photographs";
  const downloadLine = delivery.allowFullResolution
    ? "Full-resolution files available after acceptance."
    : "Marked previews only; full-resolution files are not offered on this link.";

  return (
    <main className="delivery-page delivery-editorial">
      <header className="delivery-head">
        <p className="eyebrow">Private editorial delivery</p>
        <h1>{delivery.packageName}</h1>
        {delivery.creditLine && <p className="delivery-credit">{delivery.creditLine}</p>}
        <p className="section-note">
          {count} {countWord} · link expires {formatDate(delivery.expiresAt)}
        </p>
        {accepted && (
          <p className="delivery-accepted" role="status">
            Terms accepted by {delivery.acceptedBy} on {formatDateTime(delivery.acceptedAt!)}.
            {delivery.restrictions ? ` ${delivery.restrictions}` : ""}
          </p>
        )}
      </header>

      {delivery.deliveryNote && (
        <section aria-label="A note from the photographer" className="delivery-note">
          <p>{delivery.deliveryNote}</p>
        </section>
      )}

      {gated ? (
        <div className="delivery-gate">
          <div className="delivery-gate__tease" aria-hidden="true">
            <div className="delivery-frame-blank">
              {count} {countWord} · shown after the terms are accepted
            </div>
          </div>
          <DeliveryGate
            downloadLine={downloadLine}
            token={token}
            usage={delivery.restrictions ?? delivery.terms}
          />
        </div>
      ) : (
        <>
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
              {!delivery.allowFullResolution && <p className="section-note">{downloadLine}</p>}

              {accepted ? (
                <p className="delivery-accepted" role="status">
                  Accepted by {delivery.acceptedBy} on {formatDateTime(delivery.acceptedAt!)}.
                </p>
              ) : (
                <AcceptTerms token={token} />
              )}
            </section>
          )}

          <DeliveryGallery
            accepted={accepted}
            allowFullResolution={delivery.allowFullResolution}
            creditLine={delivery.creditLine}
            frames={delivery.assets.map((asset) => ({
              assetId: asset.assetId,
              filename: asset.filename,
              headline: asset.headline,
              caption: asset.caption,
              people: asset.people,
              capturedLabel: asset.capturedAt ? formatDateTime(asset.capturedAt) : undefined,
              hasPreview: asset.hasPreview,
            }))}
            token={token}
          />
        </>
      )}

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
        <p className="section-note">No advertising trackers.</p>
      </footer>
      {analyticsAllowed && <ViewingTracker token={token} />}
    </main>
  );
}
