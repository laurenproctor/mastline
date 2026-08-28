import { headers } from "next/headers";
import { formatDateTime } from "@/lib/format";
import { openRequestLink } from "@/lib/data/request-intake";
import { isIntakeToken } from "@/lib/request-intake";
import { IntakeForm } from "./_components/intake-form";

// robots.txt is a request; this is the instruction a crawler must honour.
export const metadata = {
  title: "Send a request",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

/**
 * What a picture desk sees when a photographer opens a door for them.
 *
 * No account, no password, no software. The token is the whole of it, exactly
 * as the delivery side works, and it buys exactly one capability: creating one
 * request. There is no session here, so there is nothing for row level security
 * to decide, and the two security-definer functions behind this page cannot
 * reach an asset, a buyer, another request, or another workspace.
 *
 * An unknown token, a withdrawn link and an expired one render the same words.
 * Telling a stranger which it was tells them something about a link they do not
 * hold.
 */
export default async function RequestIntakePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  // Shape is checked here so a malformed token never reaches the database, and
  // -- this is the point -- fails with the SAME words as a real one that has
  // expired.
  const link = isIntakeToken(token)
    ? await openRequestLink(token, await headers())
    : ({ status: "invalid", alreadySubmitted: false } as const);

  if (link.status === "rate_limited") {
    return (
      <main className="auth-page">
        <div className="auth-card">
          <h1>Too many attempts</h1>
          <p className="section-note">
            Wait a few minutes and open the link again. Nothing is wrong with your link.
          </p>
        </div>
      </main>
    );
  }

  if (link.status !== "ok") {
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

  if (link.alreadySubmitted) {
    return (
      <main className="auth-page">
        <div className="auth-card">
          <h1>Your request is in</h1>
          <p className="section-note">
            {link.workspaceName} has it{link.requestReference && <> as {link.requestReference}</>}.
            This link has now been used and cannot send a second request.
          </p>
          <p className="section-note">
            That is a record of what you asked for, not a commitment to cover it. Anything further
            comes from {link.workspaceName} directly.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="intake-page">
      <header className="intake-head">
        <p className="eyebrow">A request for {link.workspaceName}</p>
        <h1>Send a request</h1>
        <p className="section-note">
          This link was prepared for <strong>{link.recipientLabel}</strong>. It closes{" "}
          {link.expiresAt && formatDateTime(link.expiresAt)}, and it can send one request.
        </p>
        {/*
          Said plainly because it is true and because the photographer's side is
          built on the same admission: a link identifies itself, never whoever
          is holding it. If this reached you second-hand, the record will say it
          came through the link prepared for the desk named above.
        */}
        <p className="section-note">
          If this was forwarded to you, that is fine — but {link.workspaceName} will see it as the
          link prepared for {link.recipientLabel}, not as yours. Put your own name at the bottom if
          you would like them to know who sent it.
        </p>
      </header>

      <IntakeForm token={token} />
    </main>
  );
}
