"use server";

import { revalidatePath } from "next/cache";
import { allocatePayment, recordLicense, recordPayment } from "@/lib/data/money";
import { getSubmission } from "@/lib/data/submissions";
import { fromMajor, money } from "@/lib/money";
import { calculateSalesEngineSplit, type LicenseOrigin } from "@/lib/sales-engine";
import { requireContext } from "@/lib/session-context";

export interface MoneyActionState {
  readonly ok?: boolean;
  readonly message?: string;
  readonly error?: string;
}

/** Read a currency amount typed as major units, e.g. "640" or "640.50". */
function parseAmount(raw: FormDataEntryValue | null): number | null {
  const text = String(raw ?? "").replace(/[$,\s]/g, "");
  if (!text) return null;
  const value = Number(text);
  if (!Number.isFinite(value) || value < 0) return null;
  return fromMajor(value).minor;
}

/**
 * Record a sale against a submission.
 *
 * The 70/30 split is computed from the contractual base and the license origin.
 * A sale made through an agency carries no Mastline share, and the database
 * enforces that independently.
 */
export async function recordSaleAction(
  _previous: MoneyActionState,
  formData: FormData,
): Promise<MoneyActionState> {
  const submissionId = String(formData.get("submissionId") ?? "") || undefined;
  const licenseeName = String(formData.get("licenseeName") ?? "").trim();
  const origin = String(formData.get("origin") ?? "external") as LicenseOrigin;
  const baseMinor = parseAmount(formData.get("saleBase"));

  if (!licenseeName) return { error: "Name who bought the licence." };
  if (baseMinor === null) return { error: "Enter the sale amount as a number." };
  if (origin !== "external" && origin !== "mastline_sales_engine") {
    return { error: "Unknown licence origin." };
  }

  const { organizationId, actorId } = await requireContext("license.write");

  let assetIds: string[] = [];
  let buyerId: string | undefined;
  if (submissionId) {
    const submission = await getSubmission(organizationId, submissionId);
    if (submission) {
      assetIds = submission.manifest.map((entry) => entry.assetId);
      buyerId = submission.buyerId;
    }
  }

  try {
    const saleBase = money(baseMinor, "USD");
    const { salesEngineShare, photographerShare } = await recordLicense({
      organizationId,
      actorId,
      submissionId,
      buyerId,
      licenseeName,
      origin,
      saleBase,
      media: String(formData.get("media") ?? "") || undefined,
      territory: String(formData.get("territory") ?? "") || undefined,
      assetIds,
    });

    const note =
      origin === "mastline_sales_engine"
        ? `Sale recorded. Mastline share ${salesEngineShare.minor / 100}, you keep ${photographerShare.minor / 100}.`
        : "Sale recorded. No Mastline share: this licence was not generated inside Mastline.";

    revalidatePath("/money");
    if (submissionId) revalidatePath(`/submissions/${submissionId}`);
    return { ok: true, message: note };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not record the sale." };
  }
}

export async function recordPaymentAction(
  _previous: MoneyActionState,
  formData: FormData,
): Promise<MoneyActionState> {
  const grossMinor = parseAmount(formData.get("gross"));
  const deductionsMinor = parseAmount(formData.get("deductions")) ?? 0;
  const platformFeeMinor = parseAmount(formData.get("platformFee")) ?? 0;
  const taxMinor = parseAmount(formData.get("tax")) ?? 0;

  if (grossMinor === null) return { error: "Enter the gross amount." };

  const netMinor = grossMinor - deductionsMinor - platformFeeMinor - taxMinor;
  if (netMinor < 0) {
    return { error: "Deductions, fees, and tax cannot exceed the gross amount." };
  }

  const { organizationId, actorId } = await requireContext("payment.write");
  const status = String(formData.get("status") ?? "received");
  const receivedAt = String(formData.get("receivedAt") ?? "");

  try {
    await recordPayment({
      organizationId,
      actorId,
      buyerId: String(formData.get("buyerId") ?? "") || undefined,
      status: status as "received" | "expected" | "invoiced" | "reported",
      source: (String(formData.get("source") ?? "manual") || "manual") as "manual",
      reference: String(formData.get("reference") ?? "") || undefined,
      gross: money(grossMinor, "USD"),
      deductions: money(deductionsMinor, "USD"),
      platformFee: money(platformFeeMinor, "USD"),
      tax: money(taxMinor, "USD"),
      net: money(netMinor, "USD"),
      receivedAt: status === "received" ? receivedAt || new Date().toISOString() : undefined,
      dueAt: String(formData.get("dueAt") ?? "") || undefined,
      expectedAt: String(formData.get("expectedAt") ?? "") || undefined,
    });

    revalidatePath("/money");
    revalidatePath("/work");
    return { ok: true, message: `Payment recorded. Net ${netMinor / 100}.` };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not record the payment." };
  }
}

export async function allocatePaymentAction(
  _previous: MoneyActionState,
  formData: FormData,
): Promise<MoneyActionState> {
  const paymentId = String(formData.get("paymentId") ?? "");
  const amountMinor = parseAmount(formData.get("amount"));
  if (amountMinor === null || amountMinor === 0) {
    return { error: "Enter the amount to attribute." };
  }

  const { organizationId, actorId } = await requireContext("payment.write");

  try {
    await allocatePayment({
      organizationId,
      actorId,
      paymentId,
      licenseId: String(formData.get("licenseId") ?? "") || undefined,
      submissionId: String(formData.get("submissionId") ?? "") || undefined,
      assetId: String(formData.get("assetId") ?? "") || undefined,
      amount: money(amountMinor, "USD"),
    });

    revalidatePath("/money");
    return { ok: true, message: "Payment attributed." };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not attribute the payment." };
  }
}

/** Preview the split before committing, so the operator sees it first. */
export async function previewSplitAction(
  baseMajor: number,
  origin: LicenseOrigin,
): Promise<{ platform: number; photographer: number }> {
  await requireContext("license.read");
  const split = calculateSalesEngineSplit(fromMajor(baseMajor), origin);
  return { platform: split.platform.minor, photographer: split.photographer.minor };
}
