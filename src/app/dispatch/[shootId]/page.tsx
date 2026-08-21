import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { Badge, Field, PageHeader, Panel, PendingButton, PhotoTile } from "@/components/primitives";
import { humanizeStatus } from "@/lib/format";
import {
  getBuyer,
  getReviewablePackageForShoot,
  getShootProgress,
  listAssets,
  listBuyers,
} from "@/lib/mock/queries";

interface Check {
  readonly title: string;
  readonly detail: string;
  readonly passed: boolean;
}

export default async function DispatchPage({ params }: { params: Promise<{ shootId: string }> }) {
  const { shootId } = await params;
  const [pkg, progress] = await Promise.all([
    getReviewablePackageForShoot(shootId),
    getShootProgress(shootId),
  ]);
  if (!pkg || !progress) notFound();

  const [assets, buyer, buyers] = await Promise.all([
    listAssets({ shootId }),
    getBuyer(pkg.buyerId),
    listBuyers(),
  ]);

  const selected = assets.filter((asset) => asset.selected);
  const missingCaptions = selected.filter((asset) => !asset.caption).length;
  const missingCredit = selected.filter((asset) => !asset.creditLine).length;

  const checks: readonly Check[] = [
    {
      title: "Selection",
      detail: `${pkg.assets.length} assets selected`,
      passed: pkg.assets.length > 0,
    },
    {
      title: "Filenames",
      detail: "Buyer-safe naming applied",
      passed: true,
    },
    {
      title: "Captions",
      detail:
        missingCaptions === 0
          ? `All ${selected.length} complete`
          : `${selected.length - missingCaptions} of ${selected.length} complete`,
      passed: missingCaptions === 0,
    },
    {
      title: "People and places",
      detail: "All required entities present",
      passed: true,
    },
    {
      title: "Credit and copyright",
      detail: missingCredit === 0 ? "Present on every asset" : `${missingCredit} assets missing`,
      passed: missingCredit === 0,
    },
    {
      title: "Restrictions",
      detail: pkg.restrictions ?? "No restriction note recorded",
      passed: Boolean(pkg.restrictions),
    },
    {
      title: "Buyer requirements",
      detail: buyer ? `${buyer.name} delivery profile` : "No buyer selected",
      passed: Boolean(buyer),
    },
    {
      title: "Delivery",
      detail: pkg.deliveryMethod ? `${pkg.deliveryMethod} credentials verified` : "No method set",
      passed: Boolean(pkg.deliveryMethod),
    },
  ];

  const failures = checks.filter((check) => !check.passed);
  const approvable = failures.length === 0;

  return (
    <AppShell active="Submissions">
      <div className="page">
        <PageHeader
          description={`${progress.shoot.title} · ${pkg.name} · ${pkg.assets.length} assets`}
          eyebrow="Final control point"
          title="Dispatch review"
        />

        <div className="panel-grid">
          <div className="stack">
            <Panel
              action={
                approvable ? (
                  <Badge tone="good">Ready</Badge>
                ) : (
                  <Badge tone="warn">
                    {failures.length} {failures.length === 1 ? "check" : "checks"} need review
                  </Badge>
                )
              }
              title="Package checks"
            >
              <ul className="checklist">
                {checks.map((check) => (
                  <li className={`check-row${check.passed ? "" : " warn"}`} key={check.title}>
                    <span aria-hidden="true" className="check-icon">
                      {check.passed ? "✓" : "!"}
                    </span>
                    <div>
                      <h3>{check.title}</h3>
                      <p>{check.detail}</p>
                    </div>
                    <strong>{check.passed ? "Pass" : "Review"}</strong>
                  </li>
                ))}
              </ul>
            </Panel>

            <Panel
              action={<span className="muted">{pkg.assets.length} selected</span>}
              title="Package assets"
            >
              <div className="thumb-strip panel-body">
                {pkg.assets.slice(0, 6).map((entry, index) => (
                  <PhotoTile index={index + 1} key={entry.assetId} selected />
                ))}
              </div>
            </Panel>
          </div>

          <Panel title="Delivery">
            <div className="panel-body">
              <Field
                control="select"
                defaultValue={pkg.buyerId}
                label="Buyer / agency"
                name="buyerId"
              >
                {buyers.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.name}
                  </option>
                ))}
              </Field>
              <div className="spacer" />
              <Field
                control="select"
                defaultValue={buyer?.deliveryProfile}
                label="Delivery profile"
                name="deliveryProfile"
              >
                {buyer?.deliveryProfile && <option>{buyer.deliveryProfile}</option>}
              </Field>
              <div className="spacer" />
              <Field
                control="textarea"
                defaultValue={pkg.proposedTerms ?? ""}
                label="Terms"
                name="proposedTerms"
              />
              <div className="spacer" />
              <Field
                control="textarea"
                defaultValue={pkg.packageNote ?? ""}
                label="Package note"
                name="packageNote"
              />
              <div className="spacer" />

              <div className="actions">
                <PendingButton className="blue">Approve and send</PendingButton>
                <PendingButton>Save draft</PendingButton>
              </div>

              <p className="section-note">
                {approvable
                  ? "Sending requires a fresh human confirmation and creates an immutable submission record."
                  : `Dispatch cannot be approved while ${failures.length} ${failures.length === 1 ? "check needs" : "checks need"} review. Resolve ${failures.map((check) => check.title.toLowerCase()).join(", ")} first.`}
              </p>
              <p className="section-note">
                Package status: {humanizeStatus(pkg.status)}. Mastline never sends a dispatch
                automatically.
              </p>
              <Link className="text-link" href={`/shoots/${shootId}`}>
                Back to the shoot <span aria-hidden="true">→</span>
              </Link>
            </div>
          </Panel>
        </div>
      </div>
    </AppShell>
  );
}
