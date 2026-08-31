"use client";

import "@/styles/mastline-dashboard-screens.css";
import Link from "next/link";
import { useActionState, useState } from "react";
import { Button } from "@/components/button";
import type { DeliveryWindowDays } from "@/lib/delivery";
import type { DispatchState } from "../actions";
import { createPrivateDeliveryAction, markFlowSharedAction } from "../flow-actions";

/**
 * The right-hand rail of Review & share: the summary of what is about to
 * become permanent, and the flow's one confirmed act.
 *
 * Before anything exists, the primary action is Create private delivery —
 * two motions, because the constitution requires a fresh human confirmation
 * before a consequential act: the first click reveals exactly what will be
 * frozen, the second commits it. It approves the package (freezing it into an
 * immutable submission) and creates one tracked recipient link. Nothing is
 * shared by it, and the copy says so.
 *
 * Once the link exists, the rail states the truth — created, not shared —
 * and offers three separate things that stay separate: copying the link
 * (which writes nothing, and says so), and Mark as shared, the deliberate
 * statement that the link has actually been sent on.
 */

export interface ReviewLink {
  readonly id: string;
  readonly url: string;
  readonly expiresAt: string;
  readonly sharedAt?: string;
}

export interface ReviewAccess {
  readonly recipientLabel?: string;
  readonly contactReference?: string;
  readonly windowDays: DeliveryWindowDays;
  readonly deliveryNote?: string;
  readonly allowFullResolution: boolean;
  readonly requireAcceptanceToView: boolean;
}

const INITIAL: DispatchState = {};

function CopyLinkButton({ url }: { url: string }) {
  const [copied, setCopied] = useState<"idle" | "done" | "failed">("idle");
  return (
    <div className="ml-delivery-review__copy">
      <Button
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(url);
            setCopied("done");
          } catch {
            setCopied("failed");
          }
        }}
        size="sm"
        type="button"
        variant="secondary"
      >
        Copy private link
      </Button>
      <p aria-live="polite" className="ml-help">
        {copied === "done" && "Link copied. Mastline has not marked it as shared."}
        {copied === "failed" && "The clipboard refused. Select the link text and copy it yourself."}
        {copied === "idle" && "Copying writes nothing to the delivery record."}
      </p>
    </div>
  );
}

export function ReviewRail({
  workspaceSlug,
  shootId,
  packageId,
  submissionId,
  approved,
  isApprovable,
  blockingTitles,
  buyerName,
  frameCount,
  terms,
  restrictions,
  access,
  link,
  previewHref,
}: {
  workspaceSlug: string;
  shootId: string;
  packageId: string;
  submissionId?: string;
  approved: boolean;
  isApprovable: boolean;
  blockingTitles: readonly string[];
  buyerName: string | null;
  frameCount: number;
  terms: string | null;
  restrictions: string | null;
  access: ReviewAccess;
  link: ReviewLink | null;
  /** The internal rehearsal of the recipient page. Post-approval only. */
  previewHref?: string;
}) {
  const [createState, createAction, creating] = useActionState(
    createPrivateDeliveryAction.bind(null, workspaceSlug),
    INITIAL,
  );
  const [shareState, shareAction, sharing] = useActionState(
    markFlowSharedAction.bind(null, workspaceSlug),
    INITIAL,
  );
  const [confirming, setConfirming] = useState(false);

  // ------------------------------------------------------------- created ----
  if (link) {
    return (
      <div className="ml-delivery-review__created">
        <h3 className="ml-section-title">Private delivery created</h3>
        <p className="ml-body">The tracked link is ready. It has not been shared.</p>

        <p className="ml-delivery-review__url">
          <code>{link.url}</code>
        </p>
        <CopyLinkButton url={link.url} />
        {previewHref && (
          <p className="ml-help">
            <Link className="ml-text-link" href={previewHref}>
              Preview recipient page
            </Link>{" "}
            — an internal rehearsal from the frozen snapshot. Nothing is recorded by looking.
          </p>
        )}

        <dl className="ml-delivery-review__facts">
          <div>
            <dt>Recipient</dt>
            <dd>{access.recipientLabel || buyerName || "Not named"}</dd>
          </div>
          <div>
            <dt>Expires</dt>
            <dd>
              {new Date(link.expiresAt).toLocaleDateString("en-GB", {
                day: "numeric",
                month: "short",
                year: "numeric",
              })}
            </dd>
          </div>
          <div>
            <dt>Full-resolution</dt>
            <dd>{access.allowFullResolution ? "Offered after acceptance" : "Not offered"}</dd>
          </div>
          <div>
            <dt>Viewing</dt>
            <dd>
              {access.requireAcceptanceToView
                ? "Waits for the terms to be accepted"
                : "Open on arrival; downloads wait for acceptance"}
            </dd>
          </div>
          <div>
            <dt>Recipient watermark</dt>
            <dd>On — previews carry the recipient&rsquo;s name</dd>
          </div>
          {access.deliveryNote && (
            <div>
              <dt>Note</dt>
              <dd>{access.deliveryNote}</dd>
            </div>
          )}
        </dl>

        {submissionId && (
          <form action={shareAction} className="ml-delivery-review__share">
            <input name="shootId" type="hidden" value={shootId} />
            <input name="packageId" type="hidden" value={packageId} />
            <input name="submissionId" type="hidden" value={submissionId} />
            <input name="deliveryId" type="hidden" value={link.id} />
            <Button disabled={sharing} type="submit">
              {sharing ? "Recording…" : "Mark as shared"}
            </Button>
            <p className="ml-help">
              Use this after you have sent the link to the recipient. It records the share; Mastline
              itself sends nothing.
            </p>
            {shareState.error && (
              <p className="ml-error" role="alert">
                {shareState.error}
              </p>
            )}
          </form>
        )}
      </div>
    );
  }

  // ----------------------------------------------------------- not ready ----
  if (!approved && !isApprovable) {
    return (
      <div className="ml-delivery-review__created">
        <h3 className="ml-section-title">Not ready</h3>
        <p className="ml-body">
          Resolve {blockingTitles.map((title) => title.toLowerCase()).join(", ")} before the
          delivery can be created.
        </p>
        <Button aria-disabled="true" disabled>
          Create private delivery
        </Button>
      </div>
    );
  }

  // ------------------------------------------------- approved, no link ------
  // (A retry after a failure between the two acts, or links all withdrawn.)
  // The same create action resumes: it finds the submission and makes the link.

  if (!confirming) {
    return (
      <div className="ml-delivery-review__created">
        <h3 className="ml-section-title">
          {approved ? "Approved and frozen" : "Ready to create the delivery"}
        </h3>
        <p className="ml-body">
          {frameCount} {frameCount === 1 ? "photograph" : "photographs"} for{" "}
          {buyerName ?? "the chosen potential buyer"}.
        </p>
        <Button onClick={() => setConfirming(true)} type="button">
          Create private delivery
        </Button>
        <p className="ml-help">
          Creates the immutable package and tracked recipient link. Nothing is shared yet.
        </p>
      </div>
    );
  }

  return (
    <form action={createAction} className="ml-delivery-review__created">
      <input name="packageId" type="hidden" value={packageId} />
      <input name="shootId" type="hidden" value={shootId} />
      <input name="confirmed" type="hidden" value="yes" />
      <input name="recipientLabel" type="hidden" value={access.recipientLabel ?? ""} />
      <input name="contactReference" type="hidden" value={access.contactReference ?? ""} />
      <input name="windowDays" type="hidden" value={access.windowDays} />
      <input name="deliveryNote" type="hidden" value={access.deliveryNote ?? ""} />
      <input
        name="allowFullResolution"
        type="hidden"
        value={access.allowFullResolution ? "1" : "0"}
      />
      <input
        name="requireAcceptanceToView"
        type="hidden"
        value={access.requireAcceptanceToView ? "1" : "0"}
      />

      <h3 className="ml-section-title">This becomes permanent</h3>
      <dl className="ml-delivery-review__facts">
        <div>
          <dt>Photographs</dt>
          <dd>{frameCount}</dd>
        </div>
        <div>
          <dt>Potential Buyer</dt>
          <dd>{buyerName ?? "—"}</dd>
        </div>
        <div>
          <dt>Terms</dt>
          <dd>{terms ?? "—"}</dd>
        </div>
        <div>
          <dt>Usage</dt>
          <dd>{restrictions ?? "None recorded"}</dd>
        </div>
      </dl>
      <p className="ml-help">
        The frames, versions, potential buyer, terms, and restrictions are frozen on the submission
        and cannot be edited afterwards. One tracked link is created for this recipient. Nothing is
        shared until you say so.
      </p>

      {createState.error && (
        <p className="ml-error" role="alert">
          {createState.error}
        </p>
      )}

      <div className="ml-delivery-review__confirm-actions">
        <Button disabled={creating} type="submit">
          {creating ? "Creating…" : "Yes, create the private delivery"}
        </Button>
        <Button
          disabled={creating}
          onClick={() => setConfirming(false)}
          type="button"
          variant="quiet"
        >
          Go back
        </Button>
      </div>
    </form>
  );
}
