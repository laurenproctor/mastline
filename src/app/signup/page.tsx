import Image from "next/image";
import Link from "next/link";
import { TRIAL_DAYS, TRIAL_PLAN, findPlan, trialTermsLabel } from "@/lib/pricing";
import { TRIAL_STORAGE_BYTES } from "@/lib/pricing";
import { formatBytes } from "@/lib/subscription";
import { SignUpForm } from "./signup-form";

export const metadata = { title: "Start free — Mastline" };

export default function SignUpPage() {
  const plan = findPlan(TRIAL_PLAN);

  return (
    <main className="auth-page">
      <div className="auth-card">
        <Image alt="Mastline" height={30} priority src="/mastline-wordmark.png" width={174} />
        <h1>Start free</h1>
        <p className="section-note">{trialTermsLabel()}</p>
        <div className="spacer" />
        <SignUpForm />
      </div>

      <aside className="auth-aside">
        <div className="eyebrow">What you get</div>
        <p className="section-note">
          {TRIAL_DAYS} days on <strong>{plan.name}</strong>, with {formatBytes(TRIAL_STORAGE_BYTES)}{" "}
          of storage. No card.
        </p>
        <ul className="check-list">
          {plan.features.slice(0, 5).map((feature) => (
            <li key={feature}>{feature}</li>
          ))}
        </ul>
        <p className="section-note">
          When the trial ends your workspace becomes read-only. Everything you imported stays, and
          you can export all of it at any time.
        </p>
        <Link className="text-link" href="/pricing">
          See all plans
        </Link>
      </aside>
    </main>
  );
}
