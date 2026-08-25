import { VerifyForm } from "./verify-form";

export const metadata = { title: "Enter the code — Mastline" };

export default async function VerifyPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const next = (await searchParams).next ?? "/work";

  return (
    <main className="gate-main" id="main">
      <div className="gate-lead">
        <span className="mk-eyebrow">Second step</span>
        <h1>One more code.</h1>
        <p className="lede">
          The password was accepted. The authenticator app is showing six digits; they change every
          thirty seconds.
        </p>
      </div>

      <div className="gate-panel">
        <VerifyForm next={next} />
      </div>

      <div className="gate-support">
        <h2 className="gate-support-head">If the phone is gone</h2>
        <ul className="gate-outs">
          <li>
            One of the recovery codes saved when two-factor authentication was switched on. Each
            works once.
          </li>
          <li>
            A recovery code turns two-factor off as it opens the account, so the first thing to do
            afterwards is set it up again on the new device.
          </li>
        </ul>
      </div>
    </main>
  );
}
