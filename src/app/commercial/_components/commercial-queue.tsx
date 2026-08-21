"use client";

import Image from "next/image";
import Link from "next/link";
import { useMemo, useState } from "react";
import type {
  CommercialOpportunity,
  CommercialOpportunityStage,
} from "@/lib/commercial-opportunities";

type StageFilter = "all" | CommercialOpportunityStage;

const STAGES: readonly { id: StageFilter; label: string }[] = [
  { id: "all", label: "All to review" },
  { id: "needs_review", label: "Needs review" },
  { id: "in_review", label: "In review" },
  { id: "pitch_ready", label: "Pitch ready" },
  { id: "won", label: "Won" },
];

const STAGE_LABELS: Record<CommercialOpportunityStage, string> = {
  needs_review: "Needs review",
  in_review: "In review",
  pitch_ready: "Pitch ready",
  won: "Won",
};

export function CommercialQueue({
  opportunities,
}: {
  opportunities: readonly CommercialOpportunity[];
}) {
  const [activeStage, setActiveStage] = useState<StageFilter>("all");
  const [selectedId, setSelectedId] = useState("julian-cross-soho");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [highPotentialOnly, setHighPotentialOnly] = useState(false);
  const [exactOnly, setExactOnly] = useState(false);

  const visible = useMemo(
    () =>
      opportunities.filter((opportunity) => {
        if (activeStage !== "all" && opportunity.stage !== activeStage) return false;
        if (highPotentialOnly && opportunity.score < 85) return false;
        if (exactOnly && opportunity.match !== "Exact") return false;
        return true;
      }),
    [activeStage, exactOnly, highPotentialOnly, opportunities],
  );

  const selected =
    visible.find((opportunity) => opportunity.id === selectedId) ?? visible[0] ?? opportunities[0];

  return (
    <div className="commercial-queue-layout">
      <section className="commercial-queue-panel" aria-label="Commercial opportunity queue">
        <div className="commercial-toolbar">
          <div className="commercial-tabs" role="tablist" aria-label="Opportunity stage">
            {STAGES.map((stage) => {
              const count =
                stage.id === "all"
                  ? opportunities.length
                  : opportunities.filter((opportunity) => opportunity.stage === stage.id).length;
              return (
                <button
                  aria-selected={activeStage === stage.id}
                  className={activeStage === stage.id ? "active" : ""}
                  key={stage.id}
                  onClick={() => setActiveStage(stage.id)}
                  role="tab"
                  type="button"
                >
                  {stage.label} <span>{count}</span>
                </button>
              );
            })}
          </div>

          <div className="commercial-filter-wrap">
            <button
              aria-expanded={filtersOpen}
              className="button small"
              onClick={() => setFiltersOpen((open) => !open)}
              type="button"
            >
              Filter <span aria-hidden="true">⌄</span>
            </button>
            {filtersOpen && (
              <div className="commercial-filter-popover">
                <strong>Opportunity filters</strong>
                <label>
                  <input
                    checked={highPotentialOnly}
                    onChange={(event) => setHighPotentialOnly(event.target.checked)}
                    type="checkbox"
                  />
                  Score 85 or higher
                </label>
                <label>
                  <input
                    checked={exactOnly}
                    onChange={(event) => setExactOnly(event.target.checked)}
                    type="checkbox"
                  />
                  Exact product matches
                </label>
                <button
                  className="text-link commercial-filter-clear"
                  onClick={() => {
                    setHighPotentialOnly(false);
                    setExactOnly(false);
                  }}
                  type="button"
                >
                  Clear filters
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="commercial-columns" aria-hidden="true">
          <span>Opportunity</span>
          <span>Brand</span>
          <span>Match</span>
          <span>Rights</span>
          <span>Potential</span>
          <span>Age</span>
        </div>

        <div className="commercial-list" role="list">
          {visible.map((opportunity) => (
            <div key={opportunity.id} role="listitem">
              <button
                aria-label={`Preview ${opportunity.subject} commercial opportunity`}
                className={`commercial-row${selected?.id === opportunity.id ? " selected" : ""}`}
                onClick={() => setSelectedId(opportunity.id)}
                type="button"
              >
                <span className="commercial-person">
                  <Image alt="" height={112} sizes="112px" src={opportunity.image} width={90} />
                  <span>
                    <strong>{opportunity.subject}</strong>
                    <small>{opportunity.item}</small>
                    <small>{opportunity.location}</small>
                    <small>{opportunity.capturedAt}</small>
                  </span>
                </span>
                <strong>{opportunity.brand}</strong>
                <span>{opportunity.match}</span>
                <span>Editorial cleared</span>
                <span className="commercial-potential">
                  <strong>{opportunity.score}</strong>
                  <small>{STAGE_LABELS[opportunity.stage]}</small>
                </span>
                <span>{opportunity.age}</span>
              </button>
            </div>
          ))}

          {visible.length === 0 && (
            <div className="commercial-empty">
              <strong>No opportunities match these filters.</strong>
              <button
                className="text-link"
                onClick={() => {
                  setActiveStage("all");
                  setHighPotentialOnly(false);
                  setExactOnly(false);
                }}
                type="button"
              >
                Show the full review list
              </button>
            </div>
          )}
        </div>

        <div className="commercial-list-foot">
          Showing {visible.length} of {opportunities.length} prototype opportunities
        </div>
      </section>

      {selected && (
        <aside className="commercial-preview" aria-label={`${selected.subject} preview`}>
          <div className="commercial-preview-head">
            <div>
              <h2>{selected.subject}</h2>
              <p>{selected.capturedAt}</p>
            </div>
            <span>{selected.age} old</span>
          </div>

          <Image
            alt={`${selected.subject} in ${selected.location}`}
            className="commercial-preview-image"
            height={620}
            priority
            sizes="(max-width: 900px) 100vw, 360px"
            src={selected.image}
            width={496}
          />

          <div className="commercial-preview-score">
            <span>Opportunity score</span>
            <strong>{selected.score}</strong>
            <em>{selected.score >= 85 ? "High" : "Review"}</em>
          </div>

          <dl className="commercial-preview-facts">
            <div>
              <dt>Leading product match</dt>
              <dd>{selected.brand}</dd>
            </div>
            <div>
              <dt>Confidence</dt>
              <dd>{selected.match}</dd>
            </div>
            <div>
              <dt>Editorial rights</dt>
              <dd>Cleared</dd>
            </div>
            <div>
              <dt>Commercial use</dt>
              <dd>Review required</dd>
            </div>
          </dl>

          <div className="commercial-rights-note">
            <p>
              <span aria-hidden="true">✓</span>
              <span>
                <strong>Editorial use cleared</strong>
                <small>Product recognition remains a suggestion.</small>
              </span>
            </p>
            <p>
              <span aria-hidden="true">!</span>
              <span>
                <strong>Commercial review required</strong>
                <small>No endorsement language or paid-ad use.</small>
              </span>
            </p>
          </div>

          <Link className="button acid commercial-review-link" href={`/commercial/${selected.id}`}>
            Review this opportunity <span aria-hidden="true">→</span>
          </Link>
        </aside>
      )}
    </div>
  );
}
