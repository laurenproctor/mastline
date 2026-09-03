import Link from "next/link";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/button";
import { listAssets } from "@/lib/data/assets";
import { listMetadata } from "@/lib/data/asset-metadata";
import { listAccessEvents, listAcceptances, listDeliveries } from "@/lib/data/delivery-links";
import { signedUrlsFor } from "@/lib/data/imports";
import { listPackages } from "@/lib/data/packages";
import { getShoot } from "@/lib/data/shoots";
import { listSubmissions } from "@/lib/data/submissions";
import { listWorkspaceBuyers } from "@/lib/data/workspace";
import {
  type DeliveryFlowFacts,
  type DeliveryFlowStage,
  clampStage,
  isDeliveryFlowStage,
} from "@/lib/delivery-flow";
import {
  DEFAULT_DELIVERY_WINDOW,
  type DeliveryWindowDays,
  deliveryUrl,
  isDeliveryWindow,
} from "@/lib/delivery";
import { reviewDispatch } from "@/lib/dispatch-rules";
import { formatDateTime, humanizeStatus } from "@/lib/format";
import { reviewAsset, reviewSelection } from "@/lib/metadata-rules";
import { reviewPreviewVersion } from "@/lib/preview-selection";
import { can } from "@/lib/permissions";
import { workspaceContext } from "@/lib/session-context";
import { createClient } from "@/lib/supabase/server";
import { workspaceRoutes } from "@/lib/workspace-routes";
import type { Asset } from "@/lib/domain";
import { startDeliveryFlowAction } from "../actions";
import { DetailsStage, type DetailFrame } from "../_components/details-stage";
import { FlowShell } from "../_components/flow-shell";
import { PackageGallery, type ReviewFrame } from "../_components/package-gallery";
import { PhotosStage, type SelectableFrame } from "../_components/photos-stage";
import { RecipientStage } from "../_components/recipient-stage";
import { ReviewRail, type ReviewAccess, type ReviewLink } from "../_components/review-rail";
import { FollowUpForm } from "../_components/follow-up-form";
import styles from "../_components/dispatch-review.module.css";

/**
 * The delivery flow: Photos → Details → Recipient → Review & share → Shared.
 *
 * One package on its way to one recipient, walked through five stages. The
 * stage is read from the URL and clamped against the record
 * (src/lib/delivery-flow.ts), so an address naming a stage the facts do not
 * support redirects to the work that is actually next — skipping ahead by
 * editing the URL is not a thing this screen can be made to do.
 *
 * The finer-grained lifecycle stays exactly what it was: approval freezes,
 * a link is created, a person marks it shared, a recipient opens it. The
 * stages are a reading of those facts, never a replacement for them.
 */

/** Approved, and therefore frozen. Not the same as sent, which happens later. */
const APPROVED = new Set(["approved", "sending", "delivered"]);
const SETTLED = new Set(["approved", "sending", "delivered", "recalled"]);

export default async function DispatchPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspace: string; shootId: string }>;
  searchParams: Promise<{
    package?: string;
    stage?: string;
    /** Link options travelling between Recipient and Review & share. */
    to?: string;
    contact?: string;
    expires?: string;
    fullres?: string;
    gate?: string;
    note?: string;
    /** The link the create act just made, so the created state names it. */
    link?: string;
  }>;
}) {
  const { workspace: requestedWorkspace, shootId } = await params;
  const query = await searchParams;
  const { package: requestedPackage, stage: requestedStageRaw } = query;
  const { session, organizationId, canonicalSlug } = await workspaceContext(requestedWorkspace);
  const routes = workspaceRoutes(canonicalSlug);
  /*
   * Everything below builds on the address the workspace holds NOW, not the one
   * the request arrived on. A request may land on a retired address, and a link
   * rendered from that would send the next click back through the rename
   * redirect.
   */
  const workspaceSlug = canonicalSlug;
  const role = session.activeWorkspace.role;

  const shoot = await getShoot(organizationId, shootId);
  if (!shoot) notFound();

  const packages = await listPackages(organizationId, { shootId });

  // Nothing to work on yet: the flow starts by making a draft, and it starts
  // with a button rather than a side effect of loading a page.
  if (packages.length === 0) {
    if (!can(role, "package.write")) notFound();
    return (
      <AppShell active="Submissions" workspace={workspaceSlug}>
        <div className="ml-page ml-delivery-flow">
          <header className="ml-page-header">
            <div className="ml-page-header__copy">
              <p className="ml-eyebrow">{shoot.title}</p>
              <h1 className="ml-display">Start a delivery</h1>
              <p className="ml-page-header__description">
                Starting creates a draft package on this shoot. Nothing is approved, created for a
                recipient, or shared until the later stages say so.
              </p>
            </div>
          </header>
          <form action={startDeliveryFlowAction.bind(null, workspaceSlug)}>
            <input name="shootId" type="hidden" value={shootId} />
            <Button type="submit">Choose photographs</Button>
          </form>
        </div>
      </AppShell>
    );
  }

  // A shoot can carry several packages. Default to one that still needs work.
  const pkg =
    packages.find((candidate) => candidate.id === requestedPackage) ??
    packages.find((candidate) => !SETTLED.has(candidate.status)) ??
    packages[0];

  const [assets, buyers, submissions] = await Promise.all([
    listAssets(organizationId, { shootId }),
    listWorkspaceBuyers(organizationId),
    listSubmissions(organizationId),
  ]);
  // The structured records, so every readiness figure on this flow means the
  // same thing as the approve action's own gate.
  const metadataRecords = await listMetadata(
    organizationId,
    assets.map((asset) => asset.id),
  );
  const buyer = buyers.find((candidate) => candidate.id === pkg.buyerId) ?? null;
  const byId = new Map(assets.map((asset) => [asset.id, asset]));

  const submission = submissions.find((candidate) => candidate.packageId === pkg.id) ?? null;
  const links = submission ? await listDeliveries(organizationId, submission.id) : [];

  const packagedAssets = pkg.assets
    .map((entry) => byId.get(entry.assetId))
    .filter((asset): asset is Asset => Boolean(asset));
  const metadata = reviewSelection(packagedAssets, undefined, metadataRecords);
  const approved = APPROVED.has(pkg.status);

  const facts: DeliveryFlowFacts = {
    frameCount: pkg.assets.length,
    detailsReady: pkg.assets.length > 0 && metadata.blocked === 0,
    recipientReady: Boolean(pkg.buyerId && pkg.deliveryMethod && pkg.proposedTerms),
    approved,
    linkCreated: links.length > 0,
    shared: links.some((link) => Boolean(link.sharedAt)) || Boolean(submission?.sentAt),
  };

  const requestedStage: DeliveryFlowStage | undefined =
    requestedStageRaw && isDeliveryFlowStage(requestedStageRaw) ? requestedStageRaw : undefined;
  const stage = clampStage(requestedStage, facts);

  // The URL never names a stage the record does not support: a request that
  // was clamped is redirected, so what the address bar says is what is shown.
  if (requestedStageRaw !== undefined && requestedStageRaw !== stage) {
    redirect(routes.dispatch({ shootId, packageId: pkg.id }, { query: { stage } }));
  }

  /*
   * Signed, short-lived preview URLs out of the private derivatives bucket —
   * the same rule approval freezes (reviewPreviewVersion), so what the flow
   * shows is what an approval would snapshot. A failure costs pictures, never
   * facts: every stage still lists filenames and metadata without them.
   */
  const previewByAsset = new Map(
    assets.map((asset) => [asset.id, reviewPreviewVersion(asset.versions)] as const),
  );
  const previewKeys = [...previewByAsset.values()]
    .map((version) => version?.objectKey)
    .filter((key): key is string => Boolean(key));
  const previewUrls = await signedUrlsFor(await createClient(), "derivatives", previewKeys, 600);
  const previewUrlFor = (assetId: string): string | undefined => {
    const key = previewByAsset.get(assetId)?.objectKey;
    return key ? previewUrls.get(key) : undefined;
  };

  const stageHref = (target: DeliveryFlowStage) =>
    routes.dispatch({ shootId, packageId: pkg.id }, { query: { stage: target } });

  const frameCount = pkg.assets.length;
  const frameWord = frameCount === 1 ? "photograph" : "photographs";
  const context = `${shoot.title} · ${pkg.name} · ${frameCount} ${frameWord}`;

  /*
   * The per-link access options describe a link that may not exist yet, so
   * between Recipient and Review & share they travel in the URL — clamped
   * here on every read — and become columns only when the delivery is
   * created. Once a link exists, the stored row is the truth and the query
   * is ignored.
   */
  const requestedWindow = Number(query.expires ?? DEFAULT_DELIVERY_WINDOW);
  const queryAccess: ReviewAccess = {
    recipientLabel:
      query.to?.slice(0, 120) || submission?.recipientLabel || buyer?.contactName || undefined,
    contactReference: query.contact?.slice(0, 200) || undefined,
    windowDays: (isDeliveryWindow(requestedWindow)
      ? requestedWindow
      : DEFAULT_DELIVERY_WINDOW) as DeliveryWindowDays,
    deliveryNote: query.note?.slice(0, 500) || undefined,
    allowFullResolution: query.fullres !== "0",
    requireAcceptanceToView: query.gate === "1",
  };

  // The flow's link: live and unshared, newest first named by the create
  // redirect, so a refresh renders the link that exists rather than a form
  // that would make another.
  const now = new Date();
  const liveUnshared = links.filter(
    (link) => !link.revokedAt && !link.sharedAt && new Date(link.expiresAt) > now,
  );
  const flowLink = liveUnshared.find((link) => link.id === query.link) ?? liveUnshared[0] ?? null;

  // ---------------------------------------------------------------- Photos --
  if (stage === "photos") {
    const selectable: SelectableFrame[] = assets
      .filter((asset) => asset.status === "active")
      .map((asset) => ({
        assetId: asset.id,
        filename: asset.canonicalFilename,
        previewUrl: previewUrlFor(asset.id),
        capturedAt: asset.capturedAt,
        missingRequired: reviewAsset(
          asset,
          undefined,
          metadataRecords.get(asset.id) ?? null,
        ).missingRequired.map((rule) => rule.label),
      }));
    const memberIds = [...pkg.assets]
      .sort((a, b) => a.position - b.position)
      .map((entry) => entry.assetId);

    return (
      <AppShell active="Submissions" workspace={workspaceSlug}>
        <FlowShell
          context={`${shoot.title} · ${pkg.name} · ${selectable.length} ${
            selectable.length === 1 ? "photograph" : "photographs"
          } on this shoot`}
          facts={facts}
          lead="Choose the photographs that will appear in this delivery. The selection saves to the draft as you go."
          packageId={pkg.id}
          shootId={shootId}
          stage={stage}
          title="Select photographs"
          workspaceSlug={workspaceSlug}
        >
          <PhotosStage
            continueHref={stageHref("details")}
            editable={can(role, "package.write")}
            frames={selectable}
            memberIds={memberIds}
            packageId={pkg.id}
            shootId={shootId}
            workspaceSlug={workspaceSlug}
          />
        </FlowShell>
      </AppShell>
    );
  }

  // --------------------------------------------------------------- Details --
  if (stage === "details") {
    const detailFrames: DetailFrame[] = [...pkg.assets]
      .sort((a, b) => a.position - b.position)
      .map((entry): DetailFrame | null => {
        const asset = byId.get(entry.assetId);
        if (!asset) return null;
        const report = reviewAsset(asset, undefined, metadataRecords.get(asset.id) ?? null);
        return {
          assetId: asset.id,
          filename: asset.canonicalFilename,
          previewUrl: previewUrlFor(asset.id),
          headline: asset.headline,
          caption: asset.caption,
          captionAwaitsReview: Boolean(asset.captionAwaitsReview),
          captionBasis: asset.captionBasis,
          people: asset.subjects,
          creditLine: asset.creditLine,
          copyrightNotice: asset.copyrightNotice,
          locationName: asset.locationName,
          usageRestrictions: asset.usageRestrictions,
          keywords: asset.keywords,
          capturedAt: asset.capturedAt,
          capturedLabel: asset.capturedAt ? formatDateTime(asset.capturedAt) : undefined,
          missingRequired: report.missingRequired.map((rule) => rule.label),
        };
      })
      .filter((frame): frame is DetailFrame => frame !== null);

    return (
      <AppShell active="Submissions" workspace={workspaceSlug}>
        <FlowShell
          context={context}
          facts={facts}
          lead="Confirm what a photo desk needs to understand and use each frame."
          packageId={pkg.id}
          shootId={shootId}
          stage={stage}
          title="Describe the photographs"
          workspaceSlug={workspaceSlug}
        >
          <DetailsStage
            backHref={stageHref("photos")}
            continueHref={stageHref("recipient")}
            editable={can(role, "asset.write")}
            frames={detailFrames}
            readyCount={metadata.ready}
            shootId={shootId}
            workspaceSlug={workspaceSlug}
          />
        </FlowShell>
      </AppShell>
    );
  }

  // ------------------------------------------------------------- Recipient --
  if (stage === "recipient") {
    return (
      <AppShell active="Submissions" workspace={workspaceSlug}>
        <FlowShell
          context={context}
          facts={facts}
          lead="Decide who receives this private delivery and what they can do with it."
          packageId={pkg.id}
          shootId={shootId}
          stage={stage}
          title="Choose recipient and access"
          workspaceSlug={workspaceSlug}
        >
          <RecipientStage
            backHref={approved ? stageHref("review") : stageHref("details")}
            buyers={buyers.map((candidate) => ({
              id: candidate.id,
              name: candidate.name,
              contactName: candidate.contactName,
              defaultTerms: candidate.defaultTerms,
              defaultRestrictions: candidate.defaultRestrictions,
            }))}
            editable={!approved && can(role, "package.write")}
            frameCount={frameCount}
            initial={{
              buyerId: pkg.buyerId,
              buyerName: buyer?.name,
              proposedTerms: pkg.proposedTerms,
              restrictions: pkg.restrictions,
              recipientLabel: query.to?.slice(0, 120) || undefined,
              contactReference: queryAccess.contactReference,
              windowDays: queryAccess.windowDays,
              deliveryNote: queryAccess.deliveryNote,
              allowFullResolution: queryAccess.allowFullResolution,
              requireAcceptanceToView: queryAccess.requireAcceptanceToView,
            }}
            packageFrozen={approved}
            packageId={pkg.id}
            reviewHrefBase={stageHref("review")}
            shootId={shootId}
            workspaceSlug={workspaceSlug}
          />
        </FlowShell>
      </AppShell>
    );
  }

  // ------------------------------------------------------ Review & share ----
  if (stage === "review") {
    const review = reviewDispatch({ pkg, assets, buyer, metadata: metadataRecords });
    const maySend = can(role, "submission.send");
    const passed = review.checks.filter((check) => check.status === "pass").length;

    const frames: ReviewFrame[] = pkg.assets.map((entry) => {
      const asset = byId.get(entry.assetId);
      const version = asset?.versions.find((candidate) => candidate.id === entry.assetVersionId);
      const report = asset
        ? reviewAsset(asset, undefined, metadataRecords.get(asset.id) ?? null)
        : undefined;
      return {
        assetId: entry.assetId,
        position: entry.position,
        assetHref: routes.asset(entry.assetId),
        previewUrl: previewUrlFor(entry.assetId),
        assetKind: asset?.assetKind ?? "image",
        filename: asset?.canonicalFilename ?? "Unreadable asset",
        headline: asset?.headline,
        caption: asset?.caption,
        captionAwaitsReview: Boolean(asset?.captionAwaitsReview),
        captionOrigin: asset?.captionOrigin,
        people: asset?.subjects ?? [],
        credit: asset?.creditLine,
        copyright: asset?.copyrightNotice,
        location: asset?.locationName,
        usageRestrictions: asset?.usageRestrictions,
        capturedAt: asset?.capturedAt,
        versionKind: version ? humanizeStatus(version.versionKind) : undefined,
        sha256: version?.sha256,
        width: version?.width,
        height: version?.height,
        mimeType: version?.mimeType,
        bytes: version?.bytes,
        missingRequired: report?.missingRequired.map((rule) => rule.label) ?? [],
        missingRecommended: report?.missingRecommended.map((rule) => rule.label) ?? [],
      };
    });

    /*
     * The created state reads the link row, never the query: once the
     * delivery exists, what it offers is what was stored. The delivery URL is
     * built from the host this request arrived on, so a preview deployment's
     * copied link points at that deployment.
     */
    const requestHeaders = await headers();
    const proto = requestHeaders.get("x-forwarded-proto") ?? "http";
    const host = requestHeaders.get("host") ?? "localhost";
    const railLink: ReviewLink | null = flowLink
      ? {
          id: flowLink.id,
          url: deliveryUrl(`${proto}://${host}`, flowLink.token),
          expiresAt: flowLink.expiresAt,
          sharedAt: flowLink.sharedAt,
        }
      : null;
    const railAccess: ReviewAccess = flowLink
      ? {
          recipientLabel: flowLink.recipientLabel,
          contactReference: flowLink.contactReference,
          windowDays: queryAccess.windowDays,
          deliveryNote: flowLink.deliveryNote,
          allowFullResolution: flowLink.allowFullResolution,
          requireAcceptanceToView: flowLink.requireAcceptanceToView,
        }
      : queryAccess;

    return (
      <AppShell active="Submissions" workspace={workspaceSlug}>
        <FlowShell
          context={`${context} · ${buyer?.name ?? "no potential buyer chosen"}`}
          facts={facts}
          lead={
            flowLink
              ? "The tracked link is ready. It has not been shared."
              : approved
                ? "This package is approved and frozen. Creating the delivery makes the tracked recipient link."
                : "The final check before Mastline creates the immutable package and the private recipient link."
          }
          packageId={pkg.id}
          shootId={shootId}
          stage={stage}
          title="Review delivery"
          workspaceSlug={workspaceSlug}
        >
          <div className={styles.body}>
            <PackageGallery
              frames={frames}
              canEditFrames={!approved && can(role, "asset.write")}
              restrictions={pkg.restrictions ?? undefined}
              shootId={shootId}
              terms={pkg.proposedTerms ?? undefined}
              workspaceSlug={workspaceSlug}
            />

            <aside aria-label="Readiness and the delivery" className={styles.sidebar}>
              <div className={styles.decision}>
                <div className={styles.readiness}>
                  <span
                    aria-hidden="true"
                    className={`${styles.readyMark} ${review.isApprovable ? "" : styles.readyMarkBlocked}`}
                  >
                    {review.isApprovable ? "✓" : "!"}
                  </span>
                  <div className={styles.readyText}>
                    <h2>{review.isApprovable ? "Ready" : "Blocked"}</h2>
                    <p>
                      {passed} of {review.checks.length} checks passed
                      {review.blocking.length > 0 &&
                        ` · ${review.blocking.length} blocking ${review.blocking.length === 1 ? "issue" : "issues"}`}
                    </p>
                  </div>
                </div>

                <dl className={styles.facts}>
                  <div className={styles.fact}>
                    <dt>Potential Buyer</dt>
                    <dd>
                      {buyer?.name ?? "Not chosen"}
                      {railAccess.recipientLabel && (
                        <span className={styles.factSub}>{railAccess.recipientLabel}</span>
                      )}
                    </dd>
                  </div>
                  <div className={styles.fact}>
                    <dt>Terms</dt>
                    <dd>{pkg.proposedTerms ?? "Not recorded"}</dd>
                  </div>
                  <div className={styles.fact}>
                    <dt>Usage</dt>
                    <dd>{pkg.restrictions ?? "None recorded"}</dd>
                  </div>
                  <div className={styles.fact}>
                    <dt>Link expires</dt>
                    <dd>
                      {flowLink
                        ? formatDateTime(flowLink.expiresAt)
                        : `${railAccess.windowDays} days after it is created`}
                    </dd>
                  </div>
                  <div className={styles.fact}>
                    <dt>Full-resolution</dt>
                    <dd>
                      {railAccess.allowFullResolution ? "Offered after acceptance" : "Not offered"}
                    </dd>
                  </div>
                  <div className={styles.fact}>
                    <dt>Viewing</dt>
                    <dd>
                      {railAccess.requireAcceptanceToView
                        ? "Waits for acceptance"
                        : "Open on arrival"}
                    </dd>
                  </div>
                  <div className={styles.fact}>
                    <dt>Recipient watermark</dt>
                    <dd>On — previews carry the recipient&rsquo;s name</dd>
                  </div>
                </dl>

                {approved && (
                  <p className={styles.note} data-lifecycle-detail>
                    Approved{pkg.approvedAt ? ` on ${formatDateTime(pkg.approvedAt)}` : ""}.{" "}
                    {facts.shared
                      ? "The share and everything after it is recorded on the submission."
                      : facts.linkCreated
                        ? "A recipient link exists and has not been marked as shared. Nothing has left Mastline."
                        : "Approved and frozen. No recipient link has been created yet."}
                  </p>
                )}

                {maySend ? (
                  <ReviewRail
                    access={railAccess}
                    approved={approved}
                    blockingTitles={review.blocking.map((check) => check.title)}
                    buyerName={buyer?.name ?? null}
                    frameCount={frameCount}
                    isApprovable={review.isApprovable}
                    link={railLink}
                    packageId={pkg.id}
                    previewHref={submission ? routes.submissionPreview(submission.id) : undefined}
                    restrictions={pkg.restrictions ?? null}
                    shootId={shootId}
                    submissionId={submission?.id}
                    terms={pkg.proposedTerms ?? null}
                    workspaceSlug={workspaceSlug}
                  />
                ) : (
                  <div>
                    <h3>Creating the delivery needs a dispatcher</h3>
                    <p className={styles.note}>
                      This role can prepare a package but not create the delivery. An owner or
                      dispatcher performs the confirmed act; the link comes from that.
                    </p>
                  </div>
                )}

                {submission && (
                  <p className={styles.note}>
                    <Link className="ml-text-link" href={routes.submission(submission.id)}>
                      View submission record
                    </Link>
                  </p>
                )}

                <details className={styles.disclosure}>
                  <summary>
                    <span>View all checks</span>
                    <span aria-hidden="true">▾</span>
                  </summary>
                  <ul className={styles.checkList}>
                    {review.checks.map((check) => (
                      <li className={styles.checkItem} key={check.id}>
                        <span
                          aria-hidden="true"
                          className={`${styles.checkMark} ${
                            check.status === "pass"
                              ? styles.checkPass
                              : check.status === "advisory"
                                ? styles.checkAdvisory
                                : styles.checkBlocked
                          }`}
                        >
                          {check.status === "pass" ? "✓" : check.status === "advisory" ? "·" : "!"}
                        </span>
                        <div>
                          <h3>{check.title}</h3>
                          <p>
                            <span className={styles.checkWord}>
                              {check.status === "pass"
                                ? "Passed"
                                : check.status === "advisory"
                                  ? "Advisory"
                                  : "Blocked"}
                            </span>{" "}
                            — {check.detail}
                          </p>
                        </div>
                      </li>
                    ))}
                  </ul>
                </details>

                <p className={styles.note}>
                  Creating the delivery freezes the frames, versions, potential buyer, terms, and
                  restrictions, and makes one tracked link.{" "}
                  <span className={styles.noteStrong}>Nothing is sent yet.</span>
                </p>
              </div>
            </aside>
          </div>
        </FlowShell>
      </AppShell>
    );
  }

  // ----------------------------------------------------------------- Shared --
  /*
   * The evidence timeline for the most recently shared link: shared, opened,
   * terms accepted, downloaded — each row drawn only from a recorded fact,
   * and a waiting row stays waiting until its evidence exists. "Share with
   * another recipient" re-enters the recipient stage: the package is frozen,
   * so the new delivery differs only in its link.
   */
  const sharedLink = links.find((link) => Boolean(link.sharedAt)) ?? null;
  const [events, acceptances] = submission
    ? await Promise.all([
        listAccessEvents(
          organizationId,
          sharedLink ? [sharedLink.id] : links.map((link) => link.id),
        ),
        listAcceptances(organizationId, submission.id),
      ])
    : [[], []];
  const chronological = [...events].reverse();
  const openedAt =
    chronological.find((event) => event.kind === "opened")?.occurredAt ?? submission?.deliveredAt;
  const downloadedAt = chronological.find((event) => event.kind === "downloaded")?.occurredAt;
  const acceptance = sharedLink
    ? (acceptances.find((record) => record.deliveryId === sharedLink.id) ?? null)
    : (acceptances[0] ?? null);
  const sharedAt = sharedLink?.sharedAt ?? submission?.sentAt;

  const timeline: readonly {
    key: string;
    label: string;
    detail: string;
    done: boolean;
  }[] = [
    {
      key: "shared",
      label: "Shared",
      detail: sharedAt ? formatDateTime(sharedAt) : "Recorded as shared",
      done: true,
    },
    {
      key: "opened",
      label: "Opened",
      detail: openedAt ? formatDateTime(openedAt) : "Waiting",
      done: Boolean(openedAt),
    },
    {
      key: "accepted",
      label: "Terms accepted",
      detail: acceptance
        ? `${acceptance.acceptedBy} · ${formatDateTime(acceptance.acceptedAt)}`
        : "Waiting",
      done: Boolean(acceptance),
    },
    {
      key: "downloaded",
      label: "Downloaded",
      detail: downloadedAt ? formatDateTime(downloadedAt) : "Waiting",
      done: Boolean(downloadedAt),
    },
  ];

  return (
    <AppShell active="Submissions" workspace={workspaceSlug}>
      <FlowShell
        context={context}
        facts={facts}
        lead="This page reflects the recorded evidence: each step below appears only once it actually happened."
        packageId={pkg.id}
        shootId={shootId}
        stage="shared"
        title="Delivery shared"
        workspaceSlug={workspaceSlug}
      >
        <div className="ml-delivery-shared">
          <section aria-label="What has happened" className="ml-delivery-shared__summary">
            <h2 className="ml-section-title">
              {pkg.status === "delivered"
                ? "A recipient has opened a link to this package"
                : "A recipient link is marked shared"}
            </h2>
            <p className="ml-body">
              {sharedLink?.recipientLabel ? `Shared with ${sharedLink.recipientLabel}. ` : ""}
              {sharedAt ? `Recorded as shared on ${formatDateTime(sharedAt)}. ` : ""}
              Mastline recorded the share; the link itself travelled outside Mastline.
            </p>

            <div className="ml-delivery-shared__actions">
              <Link
                className="ml-button"
                href={submission ? routes.submission(submission.id) : routes.submissions()}
              >
                View submission record
              </Link>
              <Link className="ml-button ml-button--secondary" href={stageHref("recipient")}>
                Share with another recipient
              </Link>
            </div>
            <p className="ml-help">
              Another recipient gets a separate tracked delivery to the same frozen package.
            </p>

            {submission && can(role, "submission.send") && (
              <FollowUpForm
                packageId={pkg.id}
                shootId={shootId}
                submissionId={submission.id}
                followUpAt={submission.followUpAt}
                workspaceSlug={workspaceSlug}
              />
            )}
          </section>

          <aside aria-label="Delivery activity" className="ml-delivery-shared__activity">
            <h2 className="ml-section-title">Delivery activity</h2>
            <p className="ml-help">
              Evidence recorded as the recipient interacts with the delivery. Refresh to see the
              latest.
            </p>
            <ol className="ml-delivery-timeline">
              {timeline.map((row) => (
                <li
                  className="ml-delivery-timeline__row"
                  data-state={row.done ? "done" : "waiting"}
                  key={row.key}
                >
                  <span aria-hidden="true" className="ml-delivery-timeline__mark">
                    {row.done ? "✓" : ""}
                  </span>
                  <span className="ml-delivery-timeline__label">{row.label}</span>
                  <span className="ml-delivery-timeline__detail">{row.detail}</span>
                </li>
              ))}
            </ol>
          </aside>
        </div>
      </FlowShell>
    </AppShell>
  );
}
