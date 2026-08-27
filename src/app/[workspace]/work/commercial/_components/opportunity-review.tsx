"use client";

import Image from "next/image";
import Link from "next/link";
import { useMemo, useState } from "react";
import type { CommercialOpportunity, ProductMatchKind } from "@/lib/commercial-opportunities";

type ReviewMode = "licensing" | "shop";

const MATCH_OPTIONS: readonly ProductMatchKind[] = [
  "Exact match",
  "Probable match",
  "Similar style",
];

export function OpportunityReview({  workspaceSlug,
 opportunity }: {
  workspaceSlug: string; opportunity: CommercialOpportunity }) {
  const [mode, setMode] = useState<ReviewMode>("licensing");
  const [confirmedIds, setConfirmedIds] = useState<readonly string[]>([]);
  const [matchKinds, setMatchKinds] = useState<Record<string, ProductMatchKind>>(() =>
    Object.fromEntries(opportunity.products.map((product) => [product.id, product.match])),
  );
  const [pitchOpen, setPitchOpen] = useState(false);
  const [pitchReady, setPitchReady] = useState(false);
  const [shopGenerated, setShopGenerated] = useState(false);
  const [toast, setToast] = useState("");

  const allConfirmed = confirmedIds.length === opportunity.products.length;
  const averageConfidence = useMemo(
    () =>
      Math.round(
        opportunity.products.reduce((sum, product) => sum + product.confidence, 0) /
          opportunity.products.length,
      ),
    [opportunity.products],
  );

  function announce(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 2600);
  }

  function toggleConfirmed(productId: string) {
    setConfirmedIds((current) =>
      current.includes(productId)
        ? current.filter((id) => id !== productId)
        : [...current, productId],
    );
  }

  function confirmAll() {
    setConfirmedIds(opportunity.products.map((product) => product.id));
    announce("All product matches confirmed. This opportunity is ready for the next review step.");
  }

  function openPitch() {
    if (!allConfirmed) {
      announce("Confirm every product match before preparing a brand pitch.");
      return;
    }
    setPitchOpen(true);
  }

  function generateShopPage() {
    if (!allConfirmed) {
      announce("Confirm every product match before generating a shop page.");
      return;
    }
    setShopGenerated(true);
    announce("Shop-the-look draft created with disclosure and tracked-link placeholders.");
  }

  return (
    <>
      <div className="commercial-review-shell">
        <section className="commercial-asset-stage" aria-label="Asset under review">
          <div className="commercial-stage-toolbar">
            <Link className="text-link" href={`/${workspaceSlug}/work/commercial`}>
              <span aria-hidden="true">←</span> Back to review list
            </Link>
            <span>{opportunity.assetId}</span>
          </div>
          <div className="commercial-stage-image-wrap">
            <Image
              alt={`${opportunity.subject} photographed in ${opportunity.location}`}
              className="commercial-stage-image"
              fill
              priority
              sizes="(max-width: 980px) 100vw, 55vw"
              src={opportunity.image}
            />
          </div>
          <dl className="commercial-asset-meta">
            <div>
              <dt>File</dt>
              <dd>{opportunity.filename}</dd>
            </div>
            <div>
              <dt>Captured</dt>
              <dd>{opportunity.capturedAt}</dd>
            </div>
            <div>
              <dt>Location</dt>
              <dd>{opportunity.location}</dd>
            </div>
            <div>
              <dt>Original</dt>
              <dd>5184 × 3456 · 38.6 MB</dd>
            </div>
          </dl>
        </section>

        <section className="commercial-review-inspector" aria-labelledby="commercial-review-title">
          <div className="eyebrow">Commercial opportunity review</div>
          <h1 id="commercial-review-title">
            {opportunity.subject} in {opportunity.location.split(",")[0]}
          </h1>

          <div className="commercial-mode-tabs" role="tablist" aria-label="Opportunity route">
            <button
              aria-selected={mode === "licensing"}
              className={mode === "licensing" ? "active" : ""}
              onClick={() => setMode("licensing")}
              role="tab"
              type="button"
            >
              Brand licensing
            </button>
            <button
              aria-selected={mode === "shop"}
              className={mode === "shop" ? "active" : ""}
              onClick={() => setMode("shop")}
              role="tab"
              type="button"
            >
              Shop the look
            </button>
          </div>

          <div className="commercial-score-block">
            <div>
              <span>Opportunity score</span>
              <strong>{opportunity.score}</strong>
            </div>
            <p>
              Strong commercial potential. Score combines visibility, product confidence, freshness,
              retail availability, and rights constraints.
            </p>
          </div>
          <div className="commercial-score-track">
            <i style={{ width: `${opportunity.score}%` }} />
            <span>{opportunity.score} / 100</span>
          </div>

          <div className="commercial-product-heading">
            <span>Detected items</span>
            <span>
              {confirmedIds.length} of {opportunity.products.length} confirmed
            </span>
          </div>

          <div className="commercial-products">
            {opportunity.products.map((product) => {
              const confirmed = confirmedIds.includes(product.id);
              return (
                <article
                  className={confirmed ? "commercial-product confirmed" : "commercial-product"}
                  key={product.id}
                >
                  <Image
                    alt={`${product.name} product candidate`}
                    height={86}
                    sizes="86px"
                    src={product.image}
                    width={86}
                  />
                  <div className="commercial-product-copy">
                    <strong>{product.name}</strong>
                    <span>{product.brand}</span>
                    <small>
                      {product.detail} · {product.price}
                    </small>
                    <label>
                      Match classification
                      <select
                        aria-label={`Match classification for ${product.name}`}
                        onChange={(event) =>
                          setMatchKinds((current) => ({
                            ...current,
                            [product.id]: event.target.value as ProductMatchKind,
                          }))
                        }
                        value={matchKinds[product.id]}
                      >
                        {MATCH_OPTIONS.map((option) => (
                          <option key={option}>{option}</option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <div className="commercial-product-decision">
                    <strong>{product.confidence}%</strong>
                    <span>{matchKinds[product.id]}</span>
                    <button
                      aria-pressed={confirmed}
                      className={confirmed ? "button small acid" : "button small"}
                      onClick={() => toggleConfirmed(product.id)}
                      type="button"
                    >
                      {confirmed ? "Confirmed ✓" : "Confirm"}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>

          {mode === "licensing" ? (
            <div className="commercial-review-actions">
              <button className="button acid" onClick={confirmAll} type="button">
                {allConfirmed ? "Matches confirmed ✓" : "Confirm all matches"}
              </button>
              <div>
                <button className="text-link" onClick={openPitch} type="button">
                  Prepare brand pitch <span aria-hidden="true">→</span>
                </button>
                <button className="text-link" onClick={() => setMode("shop")} type="button">
                  Create shop page <span aria-hidden="true">→</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="commercial-shop-panel">
              <div className="eyebrow">Shoppable editorial package</div>
              <h2>Turn the confirmed look into a publishable commerce module.</h2>
              <dl>
                <div>
                  <dt>Products</dt>
                  <dd>{opportunity.products.length}</dd>
                </div>
                <div>
                  <dt>Average confidence</dt>
                  <dd>{averageConfidence}%</dd>
                </div>
                <div>
                  <dt>Availability</dt>
                  <dd>2 exact · 7 similar</dd>
                </div>
              </dl>
              <div className="commercial-disclosure">
                <strong>Disclosure preview</strong>
                <p>
                  Mastline may earn a commission from purchases made through these links. Product
                  identifications are independently researched and do not imply endorsement.
                </p>
              </div>
              <button
                className={shopGenerated ? "button acid" : "button blue"}
                onClick={generateShopPage}
                type="button"
              >
                {shopGenerated ? "Shop page draft created ✓" : "Generate shop page draft"}
              </button>
            </div>
          )}

          <div className="commercial-guardrails">
            <p>
              <span aria-hidden="true">✓</span> Editorial use is cleared for this prototype record.
            </p>
            <p>
              <span aria-hidden="true">!</span> Commercial use remains use-specific and requires
              human review. Paid advertising and implied endorsement are excluded.
            </p>
          </div>
        </section>
      </div>

      {pitchOpen && (
        <div className="commercial-drawer-backdrop" onMouseDown={() => setPitchOpen(false)}>
          <aside
            aria-labelledby="commercial-pitch-title"
            aria-modal="true"
            className="commercial-pitch-drawer"
            onMouseDown={(event) => event.stopPropagation()}
            role="dialog"
          >
            <div className="commercial-drawer-head">
              <div>
                <div className="eyebrow">Draft outreach · not sent</div>
                <h2 id="commercial-pitch-title">Brand licensing pitch</h2>
              </div>
              <button
                aria-label="Close pitch"
                className="commercial-close"
                onClick={() => setPitchOpen(false)}
                type="button"
              >
                ×
              </button>
            </div>
            <dl className="commercial-pitch-recipient">
              <dt>Suggested recipient</dt>
              <dd>{opportunity.brand} · Global communications</dd>
            </dl>
            <div className="commercial-pitch-copy">
              <strong>New independent street-style image: {opportunity.subject}</strong>
              <p>
                An independently captured image appears to show {opportunity.subject} wearing
                {` ${opportunity.brand}`} in {opportunity.location.split(",")[0]}. The photographer
                has made the image available for appropriate editorial, internal, and approved
                organic-social licensing.
              </p>
              <p>
                The product matches were confirmed by the photographer. This draft does not claim
                endorsement by the person pictured.
              </p>
            </div>
            <div className="commercial-license-scope">
              <strong>Use-specific license</strong>
              <small>Paid advertising and endorsement language excluded.</small>
            </div>
            <button
              className={pitchReady ? "button acid" : "button blue"}
              onClick={() => {
                setPitchReady(true);
                setPitchOpen(false);
                announce("Pitch marked ready for human review. Nothing was sent.");
              }}
              type="button"
            >
              {pitchReady ? "Pitch ready ✓" : "Mark pitch ready"}
            </button>
          </aside>
        </div>
      )}

      <div aria-live="polite" className={toast ? "commercial-toast visible" : "commercial-toast"}>
        {toast}
      </div>
    </>
  );
}
