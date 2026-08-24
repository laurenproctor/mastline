import Link from "next/link";
import {
  TRIAL_DAYS,
  TRIAL_PLAN,
  TRIAL_STORAGE_BYTES,
  findPlan,
  trialTermsLabel,
} from "@/lib/pricing";
import { SALES_ENGINE_PHOTOGRAPHER_RATE } from "@/lib/sales-engine";
import { formatBytes } from "@/lib/subscription";
import { SignUpForm } from "./signup-form";

export const metadata = { title: "Start free — Mastline" };

/**
 * Every fact on this screen is read from the modules that enforce it --
 * pricing.ts for the trial, sales-engine.ts for the split -- so the screen that
 * sells the trial cannot describe a different one from the screen that bills
 * for it.
 */
export default function SignUpPage() {
  const plan = findPlan(TRIAL_PLAN);
  const share = Math.round(SALES_ENGINE_PHOTOGRAPHER_RATE * 100);

  return (
    <main className="su-main" id="main">
      <div className="su-lead">
        <span className="mk-eyebrow">Create your account</span>
        <h1>Start free</h1>
        <p className="lede">
          Long enough to run a shoot, dispatch it, record the sale, and watch the money land against
          the picture that earned it. That is the only demonstration that counts, and it is why the
          trial is as long as it is.
        </p>
        <p className="su-terms">{trialTermsLabel()}</p>
      </div>

      <div className="su-panel">
        <SignUpForm />
      </div>

      <div className="su-support">
        <ol className="su-reasons">
          <li>
            <div>
              <b>The whole of {plan.name}, not a sample.</b>
              <p>
                {TRIAL_DAYS} days on the plan that carries the archive and rights intelligence, with{" "}
                {formatBytes(TRIAL_STORAGE_BYTES)} of storage for the work you bring with you.
              </p>
            </div>
          </li>
          <li>
            <div>
              <b>Nothing to cancel.</b>
              <p>
                No card to start, so there is no subscription running quietly in the background and
                no date to remember.
              </p>
            </div>
          </li>
          <li>
            <div>
              <b>The record stays yours either way.</b>
              <p>
                If the trial ends without a decision the workspace turns read-only. Everything
                imported stays, everything remains visible, and all of it can be exported at any
                time.
              </p>
            </div>
          </li>
        </ol>

        <div className="su-split">
          <div className="keep">
            <b>100%</b>
            <span>of the sales made directly. No commission, ever.</span>
          </div>
          <div>
            <b>{share}%</b>
            <span>of the sales Mastline creates. It earns only then.</span>
          </div>
        </div>

        <Link className="more su-plans" href="/pricing">
          Compare all plans
        </Link>
      </div>
    </main>
  );
}
