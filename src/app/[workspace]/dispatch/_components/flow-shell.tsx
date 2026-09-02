import "@/styles/mastline-dashboard-screens.css";
import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { type DeliveryFlowFacts, type DeliveryFlowStage, stepStates } from "@/lib/delivery-flow";
import { workspaceRoutes } from "@/lib/workspace-routes";

/**
 * The frame every stage of the delivery flow renders inside: the five-step
 * progress strip, one serif title with its one-sentence explanation, the
 * stage's own surface, and the action bar along the bottom.
 *
 * The strip is drawn from the record (stepStates), so a step reads complete
 * because its facts are recorded, not because the reader has clicked past it.
 * A completed or open step is a link; a step the record does not support yet
 * is text, because a link to a screen that would only clamp back is a lie
 * about where the reader can go.
 */
export function FlowShell({
  workspaceSlug,
  shootId,
  packageId,
  stage,
  facts,
  context,
  title,
  lead,
  children,
  footer,
}: {
  workspaceSlug: string;
  shootId: string;
  packageId?: string;
  stage: DeliveryFlowStage;
  facts: DeliveryFlowFacts;
  /** The shoot and count line under the title, e.g. "Hudson Square · 9 photographs". */
  context?: string;
  title: string;
  /** One sentence: what this screen is for, or what the primary action will do. */
  lead?: string;
  children: ReactNode;
  /** The stage's action bar. Rendered inside the shared footer strip. */
  footer?: ReactNode;
}) {
  const routes = workspaceRoutes(workspaceSlug);
  const steps = stepStates(stage, facts);

  return (
    <div className="ml-page ml-page--wide ml-delivery-flow">
      <nav aria-label="Delivery progress" className="ml-delivery-flow__strip">
        <ol
          className="ml-stepper ml-delivery-flow__stepper"
          style={{ "--ml-step-count": 5 } as CSSProperties}
        >
          {steps.map((step, index) => {
            const destination = routes.dispatch(
              { shootId, packageId },
              { query: { stage: step.key } },
            );
            const label = (
              <>
                <span aria-hidden="true" className="ml-delivery-flow__step-mark">
                  {step.state === "complete" ? "✓" : index + 1}
                </span>
                <span>{step.label}</span>
                {step.state === "current" && (
                  <span className="visually-hidden"> — current stage</span>
                )}
                {step.state === "complete" && <span className="visually-hidden"> — complete</span>}
              </>
            );
            return (
              <li
                aria-current={step.state === "current" ? "step" : undefined}
                className="ml-step ml-delivery-flow__step"
                data-state={step.state}
                key={step.key}
              >
                {step.reachable && step.state !== "current" ? (
                  <Link className="ml-delivery-flow__step-link" href={destination}>
                    {label}
                  </Link>
                ) : (
                  <span className="ml-delivery-flow__step-label">{label}</span>
                )}
              </li>
            );
          })}
        </ol>
      </nav>

      <header className="ml-page-header ml-delivery-flow__header">
        <div className="ml-page-header__copy">
          <h1 className="ml-display">{title}</h1>
          {lead && <p className="ml-page-header__description">{lead}</p>}
          {context && <p className="ml-delivery-flow__context">{context}</p>}
        </div>
      </header>

      <div className="ml-delivery-flow__body">{children}</div>

      {footer && <div className="ml-delivery-flow__actions">{footer}</div>}
    </div>
  );
}
