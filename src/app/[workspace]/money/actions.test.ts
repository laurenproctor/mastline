import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * The money actions' validation, tested at the boundary the browser talks to.
 *
 * The data layer, the session, and the cache are stood in for, in the same way
 * the page tests stand in for their data modules. What is asserted is the
 * contract the actions keep before anything is written: which form input is
 * refused and with what words, that a refused form never consults the session
 * or touches the data layer, and that an accepted form hands the data layer
 * exact integer minor units. The money and split arithmetic is real -- only
 * the writes are fakes.
 */
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session-context", () => ({
  requireWorkspaceContext: vi.fn(async () => ({
    organizationId: "org-1",
    actorId: "user-1",
    canonicalSlug: "studio",
  })),
}));
vi.mock("@/lib/data/money", () => ({
  recordLicense: vi.fn(),
  recordPayment: vi.fn(),
  allocatePayment: vi.fn(),
}));
vi.mock("@/lib/data/submissions", () => ({ getSubmission: vi.fn(async () => null) }));

import { revalidatePath } from "next/cache";
import { allocatePayment, recordLicense, recordPayment } from "@/lib/data/money";
import { getSubmission } from "@/lib/data/submissions";
import { money } from "@/lib/money";
import { requireWorkspaceContext } from "@/lib/session-context";
import {
  allocatePaymentAction,
  previewSplitAction,
  recordPaymentAction,
  recordSaleAction,
} from "./actions";

function form(entries: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(entries)) data.set(name, value);
  return data;
}

const saleForm = (over: Record<string, string> = {}) =>
  form({ licenseeName: "The Mega Agency", origin: "external", saleBase: "640", ...over });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSubmission).mockResolvedValue(null);
  vi.mocked(recordLicense).mockResolvedValue({
    id: "license-1",
    salesEngineShare: money(0),
    photographerShare: money(64_000),
  } as never);
  vi.mocked(recordPayment).mockResolvedValue({ id: "payment-1" } as never);
  vi.mocked(allocatePayment).mockResolvedValue(undefined as never);
});

describe("recordSaleAction validation", () => {
  it("refuses a sale with nobody named as the licensee", async () => {
    const state = await recordSaleAction("studio", {}, saleForm({ licenseeName: "  " }));
    expect(state).toEqual({ error: "Name who bought the licence." });
    expect(requireWorkspaceContext).not.toHaveBeenCalled();
    expect(recordLicense).not.toHaveBeenCalled();
  });

  it.each([["" /* empty */], ["a price"], ["-640"], ["12.3.4"]])(
    "refuses %j as a sale amount before consulting the session",
    async (raw) => {
      const state = await recordSaleAction("studio", {}, saleForm({ saleBase: raw }));
      expect(state).toEqual({ error: "Enter the sale amount as a number." });
      expect(requireWorkspaceContext).not.toHaveBeenCalled();
      expect(recordLicense).not.toHaveBeenCalled();
    },
  );

  it("refuses an origin that is neither external nor the Sales Engine", async () => {
    const state = await recordSaleAction("studio", {}, saleForm({ origin: "agency_portal" }));
    expect(state).toEqual({ error: "Unknown licence origin." });
    expect(recordLicense).not.toHaveBeenCalled();
  });

  it("reads $ signs, commas, and spaces, and hands the data layer integer minor units", async () => {
    const state = await recordSaleAction("studio", {}, saleForm({ saleBase: "$1,234.50" }));
    expect(state.ok).toBe(true);
    expect(recordLicense).toHaveBeenCalledWith(
      expect.objectContaining({ saleBase: money(123_450), origin: "external" }),
    );
  });

  it("records an external sale with no Mastline share, saying so in words", async () => {
    const state = await recordSaleAction("studio", {}, saleForm());
    expect(state.ok).toBe(true);
    expect(state.message).toMatch(/No Mastline share/);
    expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith("/studio/money");
  });

  it("reports the split the data layer computed for a Sales Engine sale", async () => {
    vi.mocked(recordLicense).mockResolvedValue({
      id: "license-1",
      salesEngineShare: money(19_200),
      photographerShare: money(44_800),
    } as never);
    const state = await recordSaleAction(
      "studio",
      {},
      saleForm({ origin: "mastline_sales_engine" }),
    );
    expect(state.message).toBe("Sale recorded. Mastline share 192, photographer 448.");
  });

  it("inherits the manifest and buyer from the submission the sale is recorded against", async () => {
    vi.mocked(getSubmission).mockResolvedValue({
      buyerId: "buyer-1",
      manifest: [{ assetId: "asset-1" }, { assetId: "asset-2" }],
    } as never);

    const state = await recordSaleAction("studio", {}, saleForm({ submissionId: "sub-1" }));
    expect(state.ok).toBe(true);
    expect(getSubmission).toHaveBeenCalledWith("org-1", "sub-1");
    expect(recordLicense).toHaveBeenCalledWith(
      expect.objectContaining({
        submissionId: "sub-1",
        buyerId: "buyer-1",
        assetIds: ["asset-1", "asset-2"],
      }),
    );
    expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith("/studio/submissions/sub-1");
  });

  it("surfaces a data-layer refusal as the form error instead of throwing", async () => {
    vi.mocked(recordLicense).mockRejectedValue(
      new Error("An external licence cannot carry a platform share."),
    );
    const state = await recordSaleAction("studio", {}, saleForm());
    expect(state).toEqual({ error: "An external licence cannot carry a platform share." });
  });
});

describe("recordPaymentAction validation", () => {
  const paymentForm = (over: Record<string, string> = {}) =>
    form({ gross: "3900", deductions: "1560", status: "received", ...over });

  it("refuses a payment with no gross amount, before consulting the session", async () => {
    const state = await recordPaymentAction("studio", {}, paymentForm({ gross: "" }));
    expect(state).toEqual({ error: "Enter the gross amount." });
    expect(requireWorkspaceContext).not.toHaveBeenCalled();
    expect(recordPayment).not.toHaveBeenCalled();
  });

  it("refuses garbage as the gross amount", async () => {
    const state = await recordPaymentAction("studio", {}, paymentForm({ gross: "about 400" }));
    expect(state).toEqual({ error: "Enter the gross amount." });
  });

  it("refuses deductions that push the net below zero", async () => {
    const state = await recordPaymentAction(
      "studio",
      {},
      paymentForm({ gross: "100", deductions: "60", platformFee: "30", tax: "20" }),
    );
    expect(state).toEqual({ error: "Deductions, fees, and tax cannot exceed the gross amount." });
    expect(recordPayment).not.toHaveBeenCalled();
  });

  it("treats an unreadable optional figure as zero rather than refusing the form", async () => {
    const state = await recordPaymentAction("studio", {}, paymentForm({ deductions: "n/a" }));
    expect(state.ok).toBe(true);
    expect(recordPayment).toHaveBeenCalledWith(
      expect.objectContaining({ deductions: money(0), net: money(390_000) }),
    );
  });

  it("derives the net from the four figures and passes each separately, in minor units", async () => {
    const state = await recordPaymentAction(
      "studio",
      {},
      paymentForm({ gross: "3900", deductions: "1560", platformFee: "0", tax: "0" }),
    );
    expect(state).toEqual({ ok: true, message: "Payment recorded. Net 2340." });
    expect(recordPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        gross: money(390_000),
        deductions: money(156_000),
        platformFee: money(0),
        tax: money(0),
        net: money(234_000),
      }),
    );
  });

  it("stamps a received payment with a receipt time, and never an expected one", async () => {
    await recordPaymentAction("studio", {}, paymentForm({ status: "received" }));
    expect(vi.mocked(recordPayment).mock.calls[0][0].receivedAt).toBeTruthy();

    vi.mocked(recordPayment).mockClear();
    await recordPaymentAction("studio", {}, paymentForm({ status: "expected" }));
    expect(vi.mocked(recordPayment).mock.calls[0][0].receivedAt).toBeUndefined();
  });

  it("surfaces a data-layer failure as the form error", async () => {
    vi.mocked(recordPayment).mockRejectedValue(new Error("Currency mismatch."));
    const state = await recordPaymentAction("studio", {}, paymentForm());
    expect(state).toEqual({ error: "Currency mismatch." });
  });
});

describe("allocatePaymentAction validation", () => {
  const allocationForm = (over: Record<string, string> = {}) =>
    form({ paymentId: "payment-1", amount: "448", ...over });

  it.each([["" /* empty */], ["0"], ["nothing"]])(
    "refuses %j as an amount to attribute, before consulting the session",
    async (raw) => {
      const state = await allocatePaymentAction("studio", {}, allocationForm({ amount: raw }));
      expect(state).toEqual({ error: "Enter the amount to attribute." });
      expect(requireWorkspaceContext).not.toHaveBeenCalled();
      expect(allocatePayment).not.toHaveBeenCalled();
    },
  );

  it("attributes in minor units and leaves unchosen targets undefined rather than empty strings", async () => {
    const state = await allocatePaymentAction(
      "studio",
      {},
      allocationForm({ licenseId: "license-1", submissionId: "", assetId: "" }),
    );
    expect(state).toEqual({ ok: true, message: "Payment attributed." });
    expect(allocatePayment).toHaveBeenCalledWith(
      expect.objectContaining({
        paymentId: "payment-1",
        licenseId: "license-1",
        submissionId: undefined,
        assetId: undefined,
        amount: money(44_800),
      }),
    );
    expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith("/studio/money");
  });

  it("surfaces an over-allocation refusal from the data layer as the form error", async () => {
    vi.mocked(allocatePayment).mockRejectedValue(
      new Error("Allocations cannot exceed the payment's net."),
    );
    const state = await allocatePaymentAction("studio", {}, allocationForm());
    expect(state).toEqual({ error: "Allocations cannot exceed the payment's net." });
  });
});

describe("previewSplitAction", () => {
  it("requires read permission on licenses before previewing anything", async () => {
    await previewSplitAction("studio", 640, "mastline_sales_engine");
    expect(requireWorkspaceContext).toHaveBeenCalledWith("studio", "license.read");
  });

  it("previews the 70/30 split with the platform share rounded half away from zero", async () => {
    // Five cents: 30% is 1.5 minor units, which rounds up to Mastline (the
    // founder's rounding rule), and the photographer keeps the exact remainder.
    await expect(previewSplitAction("studio", 0.05, "mastline_sales_engine")).resolves.toEqual({
      platform: 2,
      photographer: 3,
    });
    await expect(previewSplitAction("studio", 640, "mastline_sales_engine")).resolves.toEqual({
      platform: 19_200,
      photographer: 44_800,
    });
  });

  it("previews no platform share for an externally generated license", async () => {
    await expect(previewSplitAction("studio", 640, "external")).resolves.toEqual({
      platform: 0,
      photographer: 64_000,
    });
  });
});
