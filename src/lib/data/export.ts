import type { SupabaseClient } from "@supabase/supabase-js";
import type { Id } from "../domain";
import { type ExportFile, buildExport } from "../export";
import { listActivity } from "./activity";
import { listDeliveryEngagement } from "./delivery-analytics";
import { listAcceptances, listAllDeliveries } from "./delivery-links";
import { listAssets, listCaptionHistory } from "./assets";
import { listLicenses, listPayments } from "./money";
import { listShoots } from "./shoots";
import { listSubmissions } from "./submissions";
import { listWorkspaceBuyers } from "./workspace";

/**
 * Gather everything a workspace export needs.
 *
 * Reads through the caller's client, so an export contains exactly what that
 * person is allowed to see. Confidential source notes are excluded from the
 * export entirely, not merely filtered by role: a bulk download is the wrong
 * shape for source material, and it should be a separate, deliberate act.
 */
export async function collectExport(
  organizationId: Id,
  organizationName: string,
  client?: SupabaseClient,
): Promise<readonly ExportFile[]> {
  const [assets, shoots, submissions, licenses, payments, buyers, activity, deliveries] =
    await Promise.all([
      listAssets(organizationId, {}, client),
      listShoots(organizationId, client),
      listSubmissions(organizationId, client),
      listLicenses(organizationId, client),
      listPayments(organizationId, client),
      listWorkspaceBuyers(organizationId, client),
      listActivity(organizationId, { limit: 5000 }, client),
      listAllDeliveries(organizationId, client),
    ]);

  const buyerNames = new Map(buyers.map((buyer) => [buyer.id, buyer.name]));
  const submissionReferences = new Map(
    submissions.map((submission) => [submission.id, submission.reference]),
  );

  // Engagement and acceptance, so the export carries what each recipient link
  // actually did rather than only that it existed.
  const engagement = await listDeliveryEngagement(
    organizationId,
    deliveries.map((delivery) => delivery.id),
    client,
  );
  const acceptancesBySubmission = await Promise.all(
    [...new Set(deliveries.map((delivery) => delivery.submissionId))].map((submissionId) =>
      listAcceptances(organizationId, submissionId, client),
    ),
  );
  const acceptanceByDelivery = new Map(
    acceptancesBySubmission.flat().map((acceptance) => [acceptance.deliveryId, acceptance]),
  );

  // Caption history is per asset, so it is fetched alongside rather than
  // assumed present on the list query.
  const histories = await Promise.all(
    assets.map((asset) => listCaptionHistory(organizationId, asset.id, client)),
  );

  return buildExport({
    organizationName,
    generatedAt: new Date().toISOString(),
    assets: assets.map((asset, index) => ({
      id: asset.id,
      shootId: asset.shootId,
      canonicalFilename: asset.canonicalFilename,
      status: asset.status,
      capturedAt: asset.capturedAt,
      headline: asset.headline,
      caption: asset.caption,
      subjects: asset.subjects,
      keywords: asset.keywords,
      locationName: asset.locationName,
      creatorName: asset.creatorName,
      creditLine: asset.creditLine,
      copyrightNotice: asset.copyrightNotice,
      usageRestrictions: asset.usageRestrictions,
      selected: asset.selected,
      rating: asset.rating,
      lifetimeEarnings: asset.lifetimeEarnings,
      versions: asset.versions.map((version) => ({
        id: version.id,
        versionKind: version.versionKind,
        storageBucket: version.storageBucket,
        objectKey: version.objectKey,
        sha256: version.sha256,
        bytes: version.bytes,
        mimeType: version.mimeType,
        width: version.width,
        height: version.height,
        createdAt: version.createdAt,
      })),
      captionHistory: histories[index].map((revision) => ({
        id: revision.id,
        headline: revision.headline,
        caption: revision.caption,
        editedAt: revision.editedAt,
      })),
    })),
    shoots: shoots.map((shoot) => ({
      id: shoot.id,
      title: shoot.title,
      status: shoot.status,
      priority: shoot.priority,
      startsAt: shoot.startsAt,
      locationName: shoot.locationName,
      assignmentLabel: shoot.assignmentLabel,
      storyAngle: shoot.storyAngle,
      createdAt: shoot.createdAt,
    })),
    submissions: submissions.map((submission) => ({
      id: submission.id,
      reference: submission.reference,
      packageId: submission.packageId,
      buyerName: buyerNames.get(submission.buyerId ?? "") ?? "",
      status: submission.status,
      deliveryMethod: submission.deliveryMethod,
      termsSnapshot: submission.termsSnapshot,
      restrictionsSnapshot: submission.restrictionsSnapshot,
      sentAt: submission.sentAt,
      deliveredAt: submission.deliveredAt,
      outcomeNote: submission.outcomeNote,
      assetCount: submission.manifest.length,
    })),
    deliveryLinks: deliveries.map((delivery) => {
      const measured = engagement.get(delivery.id);
      const acceptance = acceptanceByDelivery.get(delivery.id);
      return {
        id: delivery.id,
        submissionId: delivery.submissionId,
        submissionReference: submissionReferences.get(delivery.submissionId) ?? "",
        recipientLabel: delivery.recipientLabel,
        contactReference: delivery.contactReference,
        parameters: Object.entries(delivery.customParameters)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([key, value]) => `${key}=${value}`)
          .join("; "),
        createdAt: delivery.createdAt,
        sharedAt: delivery.sharedAt,
        revokedAt: delivery.revokedAt,
        expiresAt: delivery.expiresAt,
        firstOpenedAt: measured?.firstOpenedAt,
        lastOpenedAt: measured?.lastOpenedAt,
        openCount: measured?.openCount ?? 0,
        sessionCount: measured?.sessionCount ?? 0,
        visitorCount: measured?.visitorCount ?? 0,
        // Left undefined when nothing was measured, so the column is blank
        // rather than reading as a confident zero.
        activeVisibleMs: measured && measured.sessionCount > 0 ? measured.activeVisibleMs : undefined,
        downloadCount: measured?.downloadCount ?? 0,
        acceptedBy: acceptance?.acceptedBy,
        acceptedAt: acceptance?.acceptedAt,
      };
    }),
    licenses: licenses.map((license) => ({
      id: license.id,
      submissionId: license.submissionId,
      licenseeName: license.licenseeName,
      origin: license.origin,
      status: license.status,
      media: license.media,
      territory: license.territory,
      startsAt: license.startsAt,
      endsAt: license.endsAt,
      saleBase: license.saleBase,
      salesEngineShare: license.salesEngineShare,
      photographerShare: license.photographerShare,
    })),
    payments: payments.map((payment) => ({
      id: payment.id,
      reference: payment.reference,
      buyerName: buyerNames.get(payment.buyerId ?? "") ?? "",
      status: payment.status,
      source: payment.source,
      gross: payment.gross,
      deductions: payment.deductions,
      platformFee: payment.platformFee,
      tax: payment.tax,
      net: payment.net,
      expectedAt: payment.expectedAt,
      dueAt: payment.dueAt,
      receivedAt: payment.receivedAt,
      allocations: payment.allocations.map((allocation) => ({
        id: allocation.id,
        licenseId: allocation.licenseId,
        submissionId: allocation.submissionId,
        assetId: allocation.assetId,
        allocated: allocation.allocated,
      })),
    })),
    activity: activity.map((event) => ({
      id: event.id,
      entityType: event.entityType,
      entityId: event.entityId,
      action: event.action,
      summary: event.summary,
      createdAt: event.createdAt,
    })),
  });
}
