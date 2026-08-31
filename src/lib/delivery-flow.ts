/**
 * The five-stage delivery flow: Photos → Details → Recipient → Review & share
 * → Shared.
 *
 * These are the photographer-facing stages of one package on its way to one
 * recipient. They are a reading of the record, never a stored column: the
 * record keeps its finer-grained facts (package status, submission status,
 * per-link share and open evidence — see docs/DELIVERY_LINKS.md), and this
 * module translates them into the progression a person is walked through.
 *
 * Two rules the translation must keep:
 *
 *   The stages gate forward movement on real state. A URL naming a later
 *   stage than the record supports is clamped back, so "skipping ahead" by
 *   editing the address bar lands on the work that is actually next.
 *
 *   Approval is a one-way door. Once a package is approved, the selection and
 *   details stages describe frozen facts, so the flow no longer offers them
 *   as places to work; it holds at Review & share until a link is marked
 *   shared, then at Shared.
 */

export const DELIVERY_FLOW_STAGES = [
  { key: "photos", label: "Photos" },
  { key: "details", label: "Details" },
  { key: "recipient", label: "Recipient" },
  { key: "review", label: "Review & share" },
  { key: "shared", label: "Shared" },
] as const;

export type DeliveryFlowStage = (typeof DELIVERY_FLOW_STAGES)[number]["key"];

export function isDeliveryFlowStage(value: string): value is DeliveryFlowStage {
  return DELIVERY_FLOW_STAGES.some((stage) => stage.key === value);
}

export function stageIndex(stage: DeliveryFlowStage): number {
  return DELIVERY_FLOW_STAGES.findIndex((entry) => entry.key === stage);
}

/**
 * What the flow needs to know about the record. Every field is a fact somebody
 * or something wrote; nothing here is a guess about intent.
 */
export interface DeliveryFlowFacts {
  /** Frames currently in the package. */
  readonly frameCount: number;
  /** Every packaged frame carries its required metadata. */
  readonly detailsReady: boolean;
  /**
   * The recipient stage's facts are recorded: a potential buyer is chosen and
   * the terms this package is offered under are written down. Both are what
   * approval will refuse without.
   */
  readonly recipientReady: boolean;
  /** The package is approved and frozen; a submission exists. */
  readonly approved: boolean;
  /** At least one recipient link exists on the submission. */
  readonly linkCreated: boolean;
  /** A link was marked shared, or the record shows send evidence. */
  readonly shared: boolean;
}

/**
 * Whether a stage may be visited given the record.
 *
 * Before approval the three working stages open in order: photos always,
 * details once there is a frame, recipient once the details are complete.
 * Review opens when the recipient facts are recorded. After approval the
 * working stages close — their content is frozen — and Shared opens only once
 * sharing has actually been recorded, because a confirmation screen for a
 * share nobody made would be the interface claiming a send.
 */
export function stageReachable(stage: DeliveryFlowStage, facts: DeliveryFlowFacts): boolean {
  if (facts.approved) {
    if (stage === "review") return true;
    if (stage === "shared") return facts.shared;
    return false;
  }
  switch (stage) {
    case "photos":
      return true;
    case "details":
      return facts.frameCount > 0;
    case "recipient":
      return facts.frameCount > 0 && facts.detailsReady;
    case "review":
      return facts.frameCount > 0 && facts.detailsReady && facts.recipientReady;
    case "shared":
      return false;
  }
}

/** The stage the record itself says is next. Where a fresh visit lands. */
export function currentStage(facts: DeliveryFlowFacts): DeliveryFlowStage {
  if (facts.approved) return facts.shared ? "shared" : "review";
  if (facts.frameCount === 0) return "photos";
  if (!facts.detailsReady) return "details";
  if (!facts.recipientReady) return "recipient";
  return "review";
}

/**
 * The stage to render for a requested one: the request when the record
 * supports it, otherwise the record's own answer. A clamped request is not an
 * error — it is the flow refusing to draw a screen ahead of the facts.
 */
export function clampStage(
  requested: DeliveryFlowStage | undefined,
  facts: DeliveryFlowFacts,
): DeliveryFlowStage {
  if (requested && stageReachable(requested, facts)) return requested;
  return currentStage(facts);
}

export type StepState = "complete" | "current" | "upcoming";

/**
 * How each step of the progress strip is drawn for a rendered stage. Complete
 * means the record holds that stage's facts, not merely that the reader has
 * moved past it: details are complete when the metadata is, whichever screen
 * is open.
 */
export function stepStates(
  rendered: DeliveryFlowStage,
  facts: DeliveryFlowFacts,
): readonly { key: DeliveryFlowStage; label: string; state: StepState; reachable: boolean }[] {
  const renderedIndex = stageIndex(rendered);

  const complete: Record<DeliveryFlowStage, boolean> = {
    photos: facts.frameCount > 0,
    details: facts.frameCount > 0 && facts.detailsReady,
    recipient: facts.recipientReady,
    review: facts.approved && facts.linkCreated,
    shared: facts.shared,
  };

  return DELIVERY_FLOW_STAGES.map((stage, index) => ({
    key: stage.key,
    label: stage.label,
    state: index === renderedIndex ? "current" : complete[stage.key] ? "complete" : "upcoming",
    reachable: stageReachable(stage.key, facts),
  }));
}
