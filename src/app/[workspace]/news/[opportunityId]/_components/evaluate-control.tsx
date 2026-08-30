"use client";

import { useActionState } from "react";
import { type EvaluateState, evaluateAction } from "../actions";
import styles from "../evaluation.module.css";

const INITIAL: EvaluateState = {};

/**
 * The one explicit action on an evaluation: run it, or run it again.
 *
 * Nothing runs on its own. Pressing this reads the story's recorded context
 * and the workspace's own photographs, and writes the evaluation tables --
 * nothing else. A rerun over unchanged inputs writes nothing and says so.
 */
export function EvaluateControl({
  workspaceSlug,
  opportunityId,
  label,
}: {
  readonly workspaceSlug: string;
  readonly opportunityId: string;
  readonly label: "Evaluate" | "Re-evaluate";
}) {
  const [state, action, pending] = useActionState(
    evaluateAction.bind(null, workspaceSlug, opportunityId),
    INITIAL,
  );
  const errorId = `evaluate-error-${opportunityId}`;

  return (
    <form action={action} className={styles.control}>
      {state.error && (
        <p className="auth-error" id={errorId} role="alert">
          {state.error}
        </p>
      )}
      <div className="actions">
        <button
          aria-describedby={state.error ? errorId : undefined}
          className="button blue small"
          disabled={pending}
          type="submit"
        >
          {pending ? "Evaluating…" : label}
        </button>
      </div>
    </form>
  );
}
