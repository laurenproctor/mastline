import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { listAssets } from "@/lib/data/assets";
import { signedUrlsFor } from "@/lib/data/imports";
import { listPackages } from "@/lib/data/packages";
import { getShoot } from "@/lib/data/shoots";
import { listWorkspaceBuyers } from "@/lib/data/workspace";
import { reviewDispatch } from "@/lib/dispatch-rules";
import { formatDateTime, humanizeStatus } from "@/lib/format";
import { reviewAsset } from "@/lib/metadata-rules";
import { can } from "@/lib/permissions";
import { workspaceContext } from "@/lib/session-context";
import { createClient } from "@/lib/supabase/server";
import { workspaceRoutes } from "@/lib/workspace-routes";
import { ApprovePanel } from "../_components/approve-panel";
import styles from "../_components/dispatch-review.module.css";
import { PackageDetails } from "../_components/package-details";
import { PackageGallery, type ReviewFrame } from "../_components/package-gallery";

/**
 * Packages this screen has no more work for.
 *
 * `approved` and `sending` join `delivered` here because approval is the freeze
 * point: once a package is approved its frames, versions, buyer, and terms are
 * fixed by the database, so offering an editor for them would be offering
 * something the next save would refuse.
 */
const SETTLED = new Set(["approved", "sending", "delivered", "recalled"]);

/** Approved, and therefore frozen. Not the same as sent, which happens later. */
const APPROVED = new Set(["approved", "sending", "delivered"]);

/** The three things that happen to a package, in the order they happen. */
const STAGES = ["Build package", "Review & approve", "Create recipient link"] as const;
const CURRENT_STAGE = 1;

export default async function DispatchPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspace: string; shootId: string }>;
  searchParams: Promise<{ package?: string }>;
}) {
  const { workspace: requestedWorkspace, shootId } = await params;
  const { package: requestedPackage } = await searchParams;
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
  if (packages.length === 0) notFound();

  // A shoot can carry several packages for different buyers. Default to one
  // that still needs work rather than one already approved.
  const pkg =
    packages.find((candidate) => candidate.id === requestedPackage) ??
    packages.find((candidate) => !SETTLED.has(candidate.status)) ??
    packages[0];

  const [assets, buyers] = await Promise.all([
    listAssets(organizationId, { shootId }),
    listWorkspaceBuyers(organizationId),
  ]);
  const buyer = buyers.find((candidate) => candidate.id === pkg.buyerId) ?? null;
  const byId = new Map(assets.map((asset) => [asset.id, asset]));

  const review = reviewDispatch({ pkg, assets, buyer });
  const approved = APPROVED.has(pkg.status);
  const maySend = can(role, "submission.send");
  const mayEdit = !approved && can(role, "package.write");

  /*
   * Real photographs, signed briefly, out of the private derivatives bucket --
   * the same path the contact sheet and the archive use. The original and the
   * recipient's watermarked delivery version are both deliberately unreachable
   * from this screen: an internal review is not a delivery, and a URL that
   * outlived this page would blur the two.
   *
   * A failure here costs the pictures and nothing else. Every frame still lists
   * its metadata, its checks, and its manifest row, so a reviewer whose
   * previews did not load can still inspect what they are approving.
   */
  const previewKeys = pkg.assets
    .map(
      (entry) =>
        byId.get(entry.assetId)?.versions.find((version) => version.versionKind === "preview")
          ?.objectKey,
    )
    .filter((key): key is string => Boolean(key));
  const previewUrls = await signedUrlsFor(await createClient(), "derivatives", previewKeys, 600);

  const frames: ReviewFrame[] = pkg.assets.map((entry) => {
    const asset = byId.get(entry.assetId);
    const version = asset?.versions.find((candidate) => candidate.id === entry.assetVersionId);
    const previewKey = asset?.versions.find(
      (candidate) => candidate.versionKind === "preview",
    )?.objectKey;
    const report = asset ? reviewAsset(asset) : undefined;

    return {
      assetId: entry.assetId,
      position: entry.position,
      assetHref: routes.asset(entry.assetId),
      previewUrl: previewKey ? previewUrls.get(previewKey) : undefined,
      assetKind: asset?.assetKind ?? "image",
      filename: asset?.canonicalFilename ?? "Unreadable asset",

      headline: asset?.headline,
      caption: asset?.caption,
      captionAwaitsReview: Boolean(asset?.captionAwaitsReview),
      captionOrigin: asset?.captionOrigin,
      // Stored, operator-entered metadata. Nothing on this screen looks at a
      // face, and nothing infers who anybody is.
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

  const passed = review.checks.filter((check) => check.status === "pass").length;

  /*
   * Blockers split three ways, and the screen has to treat them differently.
   *
   * Package-level ones -- no buyer, no route, no terms -- are fixed in the form
   * already on this page, so the form opens itself when one of them is why the
   * package is stuck.
   *
   * Frame-level ones are fixed on the frame, which the gallery handles.
   *
   * The rest are structural: an asset that cannot be read, a version that no
   * longer exists. Nothing on a review screen can mend those, and pretending
   * otherwise with a control that cannot work is worse than saying so.
   */
  const PACKAGE_LEVEL = new Set(["buyer", "delivery_method", "terms"]);
  const packageBlockers = review.blocking.filter((check) => PACKAGE_LEVEL.has(check.id));
  const frameBlockers = review.blocking.filter((check) => check.id === "metadata");
  const structuralBlockers = review.blocking.filter(
    (check) => !PACKAGE_LEVEL.has(check.id) && check.id !== "metadata",
  );
  const frameCount = pkg.assets.length;
  const frameWord = frameCount === 1 ? "frame" : "frames";

  return (
    <AppShell active="Submissions" workspace={workspaceSlug}>
      <div className={`page ${styles.page}`}>
        <header className={styles.head}>
          <p className={styles.eyebrow}>Final control point</p>
          <h1 className={styles.title}>Package review</h1>
          <p className={styles.subject}>
            {shoot.title} · {pkg.name} · {frameCount} {frameWord}
          </p>

          {/*
            An ordered list, because the stages are ordered. The current one is
            marked with aria-current so it is announced rather than merely
            drawn, and the words say what each stage does -- approval is not
            "send", and the third stage is where a recipient first appears.
          */}
          <ol aria-label="Package lifecycle" className={styles.stages}>
            {STAGES.map((stage, index) => {
              const done = index < CURRENT_STAGE;
              const current = index === CURRENT_STAGE;
              return (
                <li
                  aria-current={current ? "step" : undefined}
                  className={`${styles.stage} ${done ? styles.stageDone : ""} ${current ? styles.stageCurrent : ""}`}
                  key={stage}
                >
                  <span aria-hidden="true" className={styles.stageMark}>
                    {done ? "✓" : ""}
                  </span>
                  <span>{stage}</span>
                  {current && <span className="visually-hidden"> — current stage</span>}
                </li>
              );
            })}
          </ol>
        </header>

        {packages.length > 1 && (
          <nav aria-label="Packages on this shoot" className={styles.packageTabs}>
            {packages.map((candidate) => (
              <Link
                aria-current={candidate.id === pkg.id ? "page" : undefined}
                className={`${styles.packageTab} ${candidate.id === pkg.id ? styles.packageTabOn : ""}`}
                href={routes.dispatch({ shootId, packageId: candidate.id })}
                key={candidate.id}
              >
                {candidate.name}
                <small>{humanizeStatus(candidate.status)}</small>
              </Link>
            ))}
          </nav>
        )}

        <div className={styles.body}>
          <PackageGallery
            frames={frames}
            // Fixing a frame is an asset edit, not a package edit, so it is
            // gated on asset.write and stays available on a package that is
            // still open. An approved package is frozen and offers none of it.
            canEditFrames={!approved && can(role, "asset.write")}
            restrictions={pkg.restrictions ?? undefined}
            shootId={shootId}
            terms={pkg.proposedTerms ?? undefined}
            workspaceSlug={workspaceSlug}
          />

          <aside aria-label="Readiness and approval" className={styles.sidebar}>
            <div className={styles.decision}>
              <div className={styles.readiness}>
                <span
                  aria-hidden="true"
                  className={`${styles.readyMark} ${review.isApprovable ? "" : styles.readyMarkBlocked}`}
                >
                  {review.isApprovable ? "✓" : "!"}
                </span>
                <div className={styles.readyText}>
                  <h2>{review.isApprovable ? "Ready to approve" : "Blocked"}</h2>
                  <p>
                    {passed} of {review.checks.length} checks passed
                    {review.blocking.length > 0 &&
                      ` · ${review.blocking.length} blocking ${review.blocking.length === 1 ? "issue" : "issues"}`}
                    {review.advisories.length > 0 && ` · ${review.advisories.length} advisory`}
                  </p>
                </div>
              </div>

              <dl className={styles.facts}>
                <div className={styles.fact}>
                  {/*
                    The label a reviewer reads. The column, the domain property
                    and the action payload are all still `buyer`; nothing below
                    this line was renamed.
                  */}
                  <dt>Potential Buyer</dt>
                  <dd>{buyer?.name ?? "Not chosen"}</dd>
                </div>
                <div className={styles.fact}>
                  <dt>Delivery route</dt>
                  <dd>{pkg.deliveryMethod ?? "Not chosen"}</dd>
                </div>
                <div className={styles.fact}>
                  <dt>Terms</dt>
                  <dd>{pkg.proposedTerms ?? "Not recorded"}</dd>
                </div>
                <div className={styles.fact}>
                  <dt>Restrictions</dt>
                  <dd>{pkg.restrictions ?? "None recorded"}</dd>
                </div>
                <div className={styles.fact}>
                  <dt>Recipient desk</dt>
                  <dd>
                    {buyer?.contactName ?? "Not chosen"}
                    {!approved && <span className={styles.factSub}>Confirmed at approval</span>}
                  </dd>
                </div>
                <div className={styles.fact}>
                  <dt>Follow-up</dt>
                  <dd>
                    {approved ? "Set on the submission" : "Not set"}
                    {!approved && <span className={styles.factSub}>Chosen at approval</span>}
                  </dd>
                </div>
                <div className={styles.fact}>
                  <dt>Frames</dt>
                  <dd>
                    {frameCount} {frameWord}
                  </dd>
                </div>
              </dl>

              {review.blocking.length > 0 && (
                <div className={styles.sideBlockers}>
                  <h3>Before this package can be sent</h3>
                  <ul>
                    {packageBlockers.map((check) => (
                      <li key={check.id}>
                        <strong>{check.title}</strong>
                        <span>
                          {check.remedy ?? check.detail}{" "}
                          {mayEdit
                            ? "Use Edit package details, open below."
                            : "This needs the package-write permission."}
                        </span>
                      </li>
                    ))}
                    {frameBlockers.map((check) => (
                      <li key={check.id}>
                        <strong>{check.title}</strong>
                        <span>
                          {check.detail} The frames are listed above the gallery, each with a Fix
                          control.
                        </span>
                      </li>
                    ))}
                    {structuralBlockers.map((check) => (
                      <li key={check.id}>
                        <strong>{check.title}</strong>
                        <span>
                          {check.detail} {check.remedy}{" "}
                          <Link className="text-link" href={routes.shoot(shootId)}>
                            Rebuild the package on the shoot
                          </Link>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
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
                        {/* The word, not only the mark, so status survives in
                            black and white. */}
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
                        {check.remedy && <p>{check.remedy}</p>}
                      </div>
                    </li>
                  ))}
                </ul>
              </details>

              {mayEdit && (
                <details className={styles.disclosure} open={packageBlockers.length > 0}>
                  <summary>
                    <span>
                      Edit package details
                      {packageBlockers.length > 0 && " — needed"}
                    </span>
                    <span aria-hidden="true">▾</span>
                  </summary>
                  <PackageDetails
                    workspaceSlug={workspaceSlug}
                    buyerId={pkg.buyerId}
                    buyers={buyers.map((candidate) => ({
                      id: candidate.id,
                      name: candidate.name,
                      deliveryProfile: candidate.deliveryProfile,
                    }))}
                    deliveryMethod={pkg.deliveryMethod}
                    editable
                    packageId={pkg.id}
                    packageNote={pkg.packageNote}
                    proposedTerms={pkg.proposedTerms}
                    restrictions={pkg.restrictions}
                  />
                </details>
              )}

              <p className={styles.note}>
                Approval freezes the selected frames, versions, potential buyer, terms, and
                restrictions. <span className={styles.noteStrong}>Nothing is sent yet.</span>
              </p>

              {approved ? (
                /*
                 * Approved is not sent. The three states below are the three
                 * things that are actually true at this point, and the
                 * operator's next step -- a link for a recipient -- lives on
                 * the submission, so that is where this points.
                 */
                <div>
                  <h3>
                    {pkg.status === "delivered"
                      ? "A recipient has opened a link to this package"
                      : pkg.status === "sending"
                        ? "A recipient link for this package is marked shared"
                        : "This package is approved and frozen"}
                  </h3>
                  <p className={styles.note}>
                    Approved
                    {pkg.approvedAt ? ` on ${formatDateTime(pkg.approvedAt)}` : ""}. The frames,
                    versions, potential buyer, and terms can no longer change.
                    {pkg.status === "approved"
                      ? " Nothing has been sent: the next step is a recipient link."
                      : ""}
                  </p>
                  <Link className="button small" href={routes.submissions()}>
                    Open the submission
                  </Link>
                </div>
              ) : maySend ? (
                <ApprovePanel
                  workspaceSlug={workspaceSlug}
                  assetCount={frameCount}
                  blockingTitles={review.blocking.map((check) => check.title)}
                  buyerName={buyer?.name ?? null}
                  defaultRecipient={buyer?.contactName ?? null}
                  isApprovable={review.isApprovable}
                  packageId={pkg.id}
                  restrictions={pkg.restrictions ?? null}
                  terms={pkg.proposedTerms ?? null}
                />
              ) : (
                <div>
                  <h3>Approval needs a dispatcher</h3>
                  <p className={styles.note}>
                    This role can prepare a package but not approve it. An owner or dispatcher
                    approves the package; a recipient link comes after that.
                  </p>
                </div>
              )}
            </div>
          </aside>
        </div>
      </div>
    </AppShell>
  );
}
