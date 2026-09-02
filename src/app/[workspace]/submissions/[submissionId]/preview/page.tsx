import Link from "next/link";
import { notFound } from "next/navigation";
import { listSubmissionAssets, getSubmission } from "@/lib/data/submissions";
import { signedUrlsFor } from "@/lib/data/imports";
import { formatDate, formatDateTime } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { workspaceContext } from "@/lib/session-context";
import { workspaceRoutes } from "@/lib/workspace-routes";

export const metadata = { title: "Recipient preview — Mastline" };

/**
 * The internal rehearsal of a delivery: what a recipient would read, rendered
 * for the photographer from the submission's own frozen snapshot.
 *
 * Deliberately NOT the recipient page. No token exists here, nothing is
 * recorded, no lifecycle moves, and the images are the workspace's own signed
 * previews rather than the marked files a real link serves — because a mark
 * names a recipient, and this page has none. The banner says all of that, so
 * an operator can never mistake a rehearsal for evidence of a delivery.
 */
export default async function RecipientPreviewPage({
  params,
}: {
  params: Promise<{ workspace: string; submissionId: string }>;
}) {
  const { workspace: requestedWorkspace, submissionId } = await params;
  const { organizationId, canonicalSlug } = await workspaceContext(requestedWorkspace);
  const routes = workspaceRoutes(canonicalSlug);

  const submission = await getSubmission(organizationId, submissionId);
  if (!submission) notFound();
  const frames = await listSubmissionAssets(organizationId, submissionId);

  const previewKeys = frames
    .map((frame) => frame.previewObjectKey)
    .filter((key): key is string => Boolean(key));
  const previewUrls = await signedUrlsFor(await createClient(), "derivatives", previewKeys, 600);

  return (
    <main className="delivery-page delivery-editorial">
      <p className="delivery-preview-banner" role="note">
        Internal preview of the recipient page, rendered from the approved snapshot. No link is
        involved, nothing is recorded, and a real recipient sees every frame watermarked with their
        own name.{" "}
        <Link className="text-link" href={routes.submission(submissionId)}>
          Back to the submission
        </Link>
      </p>

      <header className="delivery-head">
        <p className="eyebrow">Private editorial delivery</p>
        <h1>{submission.reference}</h1>
        {frames[0]?.creditLine && <p className="delivery-credit">{frames[0].creditLine}</p>}
        <p className="section-note">
          {frames.length} {frames.length === 1 ? "photograph" : "photographs"}
          {submission.followUpAt ? ` · follow-up ${formatDate(submission.followUpAt)}` : ""}
        </p>
      </header>

      {(submission.termsSnapshot || submission.restrictionsSnapshot) && (
        <section className="delivery-terms">
          <h2>Terms</h2>
          {submission.termsSnapshot && <p className="section-note">{submission.termsSnapshot}</p>}
          {submission.restrictionsSnapshot && (
            <p className="section-note">{submission.restrictionsSnapshot}</p>
          )}
        </section>
      )}

      <section className="delivery-frames">
        {frames.map((frame) => {
          const url = frame.previewObjectKey ? previewUrls.get(frame.previewObjectKey) : undefined;
          return (
            <article className="delivery-frame" key={frame.id}>
              {url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img alt={frame.headline ?? frame.filename} src={url} />
              ) : (
                <div className="delivery-frame-blank">No preview · {frame.filename}</div>
              )}
              <div className="delivery-frame-body">
                <h3>{frame.headline ?? frame.filename}</h3>
                {frame.caption && <p className="section-note">{frame.caption}</p>}
                <p className="section-note">
                  {frame.people.length > 0 ? frame.people.join(", ") : "No people identified"}
                </p>
                {frame.capturedAt && (
                  <p className="section-note">{formatDateTime(frame.capturedAt)}</p>
                )}
              </div>
            </article>
          );
        })}
      </section>
    </main>
  );
}
