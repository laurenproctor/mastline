import type { SupabaseClient } from "@supabase/supabase-js";
import type { Id, License, LicenseStatus, Payment, PaymentStatus } from "../domain";
import { type Money, money, subtract, sum, zero } from "../money";
import { type LicenseOrigin, calculateSalesEngineSplit } from "../sales-engine";
import { createClient } from "../supabase/server";
import { recordEventWith } from "./activity";

/**
 * Licenses, payments, and the allocations that connect money to work.
 *
 * Two rules run through everything here:
 *
 *   * The Sales Engine share is computed by calculateSalesEngineSplit and only
 *     for a license Mastline generated. It is never derived from displayed net
 *     revenue, and the database refuses a fee on an external license anyway.
 *   * Allocations divide a payment's NET -- the money that actually arrived.
 *     Gross, deductions, tax, and the platform fee stay on the payment and
 *     remain separately inspectable there.
 */

export const RECEIVED: readonly PaymentStatus[] = ["received"];
export const OUTSTANDING: readonly PaymentStatus[] = ["expected", "invoiced", "partial", "overdue"];

interface LicenseRow {
  id: string;
  organization_id: string;
  submission_id: string | null;
  buyer_id: string | null;
  status: string;
  licensee_name: string;
  media: string | null;
  territory: string | null;
  starts_at: string | null;
  ends_at: string | null;
  exclusivity: string | null;
  origin: string;
  sale_base_minor: number;
  sales_engine_share_minor: number;
  photographer_share_minor: number;
  currency: string;
}

function toLicense(row: LicenseRow, assetIds: readonly string[]): License {
  return {
    id: row.id,
    organizationId: row.organization_id,
    submissionId: row.submission_id ?? undefined,
    buyerId: row.buyer_id ?? undefined,
    status: row.status as LicenseStatus,
    licenseeName: row.licensee_name,
    media: row.media ?? undefined,
    territory: row.territory ?? undefined,
    startsAt: row.starts_at ?? undefined,
    endsAt: row.ends_at ?? undefined,
    exclusivity: row.exclusivity ?? undefined,
    saleBase: money(Number(row.sale_base_minor), (row.currency as "USD") ?? "USD"),
    origin: row.origin as LicenseOrigin,
    assetIds,
  };
}

export interface LicenseWithShares extends License {
  readonly salesEngineShare: Money;
  readonly photographerShare: Money;
}

export async function listLicenses(
  organizationId: Id,
  client?: SupabaseClient,
): Promise<readonly LicenseWithShares[]> {
  const supabase = client ?? (await createClient());
  const { data, error } = await supabase
    .from("licenses")
    .select(
      "id, organization_id, submission_id, buyer_id, status, licensee_name, media, territory, starts_at, ends_at, exclusivity, origin, sale_base_minor, sales_engine_share_minor, photographer_share_minor, currency, license_assets(asset_id)",
    )
    .eq("organization_id", organizationId)
    .order("starts_at", { ascending: false, nullsFirst: false });

  if (error) throw new Error(`Could not load licenses: ${error.message}`);

  return (data ?? []).map((row) => {
    const assetIds = ((row.license_assets ?? []) as { asset_id: string }[]).map(
      (entry) => entry.asset_id,
    );
    const license = toLicense(row as unknown as LicenseRow, assetIds);
    return {
      ...license,
      salesEngineShare: money(Number(row.sales_engine_share_minor), license.saleBase.currency),
      photographerShare: money(Number(row.photographer_share_minor), license.saleBase.currency),
    };
  });
}

/**
 * Record a sale.
 *
 * The split is computed here from the contractual base and the origin, and the
 * database re-checks both invariants: the shares must reconstitute the base,
 * and an external license may not carry a platform fee.
 */
export async function recordLicense(input: {
  client?: SupabaseClient;
  organizationId: Id;
  actorId: Id;
  submissionId?: Id;
  buyerId?: Id;
  licenseeName: string;
  origin: LicenseOrigin;
  saleBase: Money;
  media?: string;
  territory?: string;
  startsAt?: string;
  endsAt?: string;
  exclusivity?: string;
  assetIds: readonly Id[];
}): Promise<{ id: Id; salesEngineShare: Money; photographerShare: Money }> {
  const { organizationId, actorId, saleBase, origin } = input;
  const supabase = input.client ?? (await createClient());

  const split = calculateSalesEngineSplit(saleBase, origin);

  const { data, error } = await supabase
    .from("licenses")
    .insert({
      organization_id: organizationId,
      submission_id: input.submissionId ?? null,
      buyer_id: input.buyerId ?? null,
      status: "active",
      licensee_name: input.licenseeName,
      media: input.media ?? null,
      territory: input.territory ?? null,
      starts_at: input.startsAt ?? new Date().toISOString(),
      ends_at: input.endsAt ?? null,
      exclusivity: input.exclusivity ?? null,
      origin,
      sale_base_minor: split.base.minor,
      sales_engine_share_minor: split.platform.minor,
      photographer_share_minor: split.photographer.minor,
      currency: saleBase.currency,
      created_by: actorId,
    })
    .select("id")
    .single();

  if (error || !data) throw new Error(`Could not record the license: ${error?.message}`);
  const licenseId = data.id as string;

  if (input.assetIds.length > 0) {
    const { error: linkError } = await supabase.from("license_assets").insert(
      input.assetIds.map((assetId) => ({
        license_id: licenseId,
        organization_id: organizationId,
        asset_id: assetId,
      })),
    );
    if (linkError) throw new Error(`Could not link assets to the license: ${linkError.message}`);
  }

  await recordEventWith(supabase, {
    organizationId,
    actorId,
    entityType: "license",
    entityId: licenseId,
    action: "license.recorded",
    data: {
      summary: `Sale recorded: ${input.licenseeName}`,
      origin,
      sale_base_minor: split.base.minor,
      sales_engine_share_minor: split.platform.minor,
    },
  });

  return { id: licenseId, salesEngineShare: split.platform, photographerShare: split.photographer };
}

interface PaymentRow {
  id: string;
  organization_id: string;
  buyer_id: string | null;
  status: string;
  source: string;
  external_reference: string | null;
  gross_minor: number;
  deductions_minor: number;
  platform_fee_minor: number;
  tax_minor: number;
  net_minor: number;
  currency: string;
  reverses_payment_id: string | null;
  expected_at: string | null;
  due_at: string | null;
  received_at: string | null;
}

export interface PaymentWithAllocations extends Payment {
  readonly reversesPaymentId?: Id;
  readonly allocatedTotal: Money;
  readonly unallocated: Money;
}

function toPayment(row: PaymentRow, allocations: Payment["allocations"]): PaymentWithAllocations {
  const currency = (row.currency as "USD") ?? "USD";
  const net = money(Number(row.net_minor), currency);
  const allocatedTotal = sum(
    allocations.map((allocation) => allocation.allocated),
    currency,
  );
  const remainder = subtract(net, allocatedTotal);

  return {
    id: row.id,
    organizationId: row.organization_id,
    buyerId: row.buyer_id ?? undefined,
    status: row.status as PaymentStatus,
    source: row.source as Payment["source"],
    reference: row.external_reference ?? undefined,
    gross: money(Number(row.gross_minor), currency),
    deductions: money(Number(row.deductions_minor), currency),
    platformFee: money(Number(row.platform_fee_minor), currency),
    tax: money(Number(row.tax_minor), currency),
    net,
    expectedAt: row.expected_at ?? undefined,
    dueAt: row.due_at ?? undefined,
    receivedAt: row.received_at ?? undefined,
    allocations,
    reversesPaymentId: row.reverses_payment_id ?? undefined,
    allocatedTotal,
    unallocated: remainder.minor > 0 ? remainder : zero(currency),
  };
}

export async function listPayments(
  organizationId: Id,
  client?: SupabaseClient,
): Promise<readonly PaymentWithAllocations[]> {
  const supabase = client ?? (await createClient());
  const { data, error } = await supabase
    .from("payments")
    .select(
      "id, organization_id, buyer_id, status, source, external_reference, gross_minor, deductions_minor, platform_fee_minor, tax_minor, net_minor, currency, reverses_payment_id, expected_at, due_at, received_at, payment_allocations(id, payment_id, license_id, submission_id, asset_id, allocated_minor, currency)",
    )
    .eq("organization_id", organizationId)
    .order("received_at", { ascending: false, nullsFirst: false })
    .order("due_at", { ascending: true, nullsFirst: false });

  if (error) throw new Error(`Could not load payments: ${error.message}`);

  return (data ?? []).map((row) => {
    const allocations = ((row.payment_allocations ?? []) as Record<string, unknown>[]).map(
      (allocation) => ({
        id: allocation.id as string,
        paymentId: allocation.payment_id as string,
        licenseId: (allocation.license_id as string | null) ?? undefined,
        submissionId: (allocation.submission_id as string | null) ?? undefined,
        assetId: (allocation.asset_id as string | null) ?? undefined,
        allocated: money(
          Number(allocation.allocated_minor),
          (allocation.currency as "USD") ?? "USD",
        ),
      }),
    );
    return toPayment(row as unknown as PaymentRow, allocations);
  });
}

export async function recordPayment(input: {
  client?: SupabaseClient;
  organizationId: Id;
  actorId: Id;
  buyerId?: Id;
  status: PaymentStatus;
  source: Payment["source"];
  reference?: string;
  gross: Money;
  deductions?: Money;
  platformFee?: Money;
  tax?: Money;
  net: Money;
  expectedAt?: string;
  dueAt?: string;
  receivedAt?: string;
  allocations?: readonly { licenseId?: Id; submissionId?: Id; assetId?: Id; amount: Money }[];
}): Promise<{ id: Id }> {
  const { organizationId, actorId } = input;
  const supabase = input.client ?? (await createClient());

  const allocations = input.allocations ?? [];
  const allocationTotal = sum(
    allocations.map((allocation) => allocation.amount),
    input.net.currency,
  );
  if (allocationTotal.minor > input.net.minor) {
    throw new Error(
      "Allocations cannot exceed the net amount that arrived. Allocations divide net, not gross.",
    );
  }

  const { data, error } = await supabase
    .from("payments")
    .insert({
      organization_id: organizationId,
      buyer_id: input.buyerId ?? null,
      status: input.status,
      source: input.source,
      external_reference: input.reference ?? null,
      gross_minor: input.gross.minor,
      deductions_minor: input.deductions?.minor ?? 0,
      platform_fee_minor: input.platformFee?.minor ?? 0,
      tax_minor: input.tax?.minor ?? 0,
      net_minor: input.net.minor,
      currency: input.net.currency,
      expected_at: input.expectedAt ?? null,
      due_at: input.dueAt ?? null,
      received_at: input.receivedAt ?? null,
      created_by: actorId,
    })
    .select("id")
    .single();

  if (error || !data) throw new Error(`Could not record the payment: ${error?.message}`);
  const paymentId = data.id as string;

  if (allocations.length > 0) {
    const { error: allocationError } = await supabase.from("payment_allocations").insert(
      allocations.map((allocation) => ({
        organization_id: organizationId,
        payment_id: paymentId,
        license_id: allocation.licenseId ?? null,
        submission_id: allocation.submissionId ?? null,
        asset_id: allocation.assetId ?? null,
        allocated_minor: allocation.amount.minor,
        currency: allocation.amount.currency,
        created_by: actorId,
      })),
    );
    if (allocationError) {
      throw new Error(`The payment was recorded but not allocated: ${allocationError.message}`);
    }
  }

  await recordEventWith(supabase, {
    organizationId,
    actorId,
    entityType: "payment",
    entityId: paymentId,
    action: "payment.recorded",
    data: {
      summary: `Payment recorded: ${input.reference ?? input.source}`,
      net_minor: input.net.minor,
      status: input.status,
    },
  });

  return { id: paymentId };
}

/** Attribute part of an already-recorded payment to what earned it. */
export async function allocatePayment(input: {
  client?: SupabaseClient;
  organizationId: Id;
  actorId: Id;
  paymentId: Id;
  licenseId?: Id;
  submissionId?: Id;
  assetId?: Id;
  amount: Money;
}): Promise<void> {
  const { organizationId, actorId, paymentId, amount } = input;
  const supabase = input.client ?? (await createClient());

  const { data: payment } = await supabase
    .from("payments")
    .select("net_minor, payment_allocations(allocated_minor)")
    .eq("organization_id", organizationId)
    .eq("id", paymentId)
    .maybeSingle();

  if (!payment) throw new Error("That payment could not be found in this workspace.");

  const already = ((payment.payment_allocations ?? []) as { allocated_minor: number }[]).reduce(
    (total, row) => total + Number(row.allocated_minor),
    0,
  );
  if (already + amount.minor > Number(payment.net_minor)) {
    throw new Error(
      `Allocating ${amount.minor} would exceed the net that arrived. ${Number(payment.net_minor) - already} minor units remain.`,
    );
  }

  const { error } = await supabase.from("payment_allocations").insert({
    organization_id: organizationId,
    payment_id: paymentId,
    license_id: input.licenseId ?? null,
    submission_id: input.submissionId ?? null,
    asset_id: input.assetId ?? null,
    allocated_minor: amount.minor,
    currency: amount.currency,
    created_by: actorId,
  });

  if (error) throw new Error(`Could not allocate the payment: ${error.message}`);

  await recordEventWith(supabase, {
    organizationId,
    actorId,
    entityType: "payment",
    entityId: paymentId,
    action: "payment.allocated",
    data: { summary: `Allocated ${amount.minor} minor units`, allocated_minor: amount.minor },
  });
}

export interface MoneySummary {
  readonly netReceived: Money;
  readonly outstanding: Money;
  readonly unallocatedStatementTotal: Money;
  readonly salesEngineShareToDate: Money;
  readonly averageDaysToPayment: number;
  readonly overdueCount: number;
}

export async function getMoneySummary(
  organizationId: Id,
  client?: SupabaseClient,
): Promise<MoneySummary> {
  const payments = await listPayments(organizationId, client);
  const licenses = await listLicenses(organizationId, client);

  const received = payments.filter((payment) => RECEIVED.includes(payment.status));
  const outstanding = payments.filter((payment) => OUTSTANDING.includes(payment.status));
  const unallocated = payments.filter(
    (payment) => payment.source === "statement" && payment.unallocated.minor > 0,
  );

  const settled = received.filter((payment) => payment.expectedAt && payment.receivedAt);
  const averageDaysToPayment =
    settled.length === 0
      ? 0
      : Math.round(
          settled.reduce((total, payment) => {
            const expected = new Date(payment.expectedAt as string).getTime();
            const arrived = new Date(payment.receivedAt as string).getTime();
            return total + (arrived - expected) / 86_400_000;
          }, 0) / settled.length,
        );

  return {
    netReceived: sum(
      received.map((payment) => payment.net),
      "USD",
    ),
    outstanding: sum(
      outstanding.map((payment) => payment.net),
      "USD",
    ),
    unallocatedStatementTotal: sum(
      unallocated.map((payment) => payment.unallocated),
      "USD",
    ),
    salesEngineShareToDate: sum(
      licenses.map((license) => license.salesEngineShare),
      "USD",
    ),
    averageDaysToPayment,
    overdueCount: payments.filter((payment) => payment.status === "overdue").length,
  };
}

export interface RevenueSource {
  readonly label: string;
  readonly amount: Money;
}

export async function getRevenueBySource(
  organizationId: Id,
  client?: SupabaseClient,
): Promise<readonly RevenueSource[]> {
  const supabase = client ?? (await createClient());
  const [payments, { data: buyers }] = await Promise.all([
    listPayments(organizationId, client),
    supabase.from("buyers").select("id, name").eq("organization_id", organizationId),
  ]);

  const buyerNames = new Map((buyers ?? []).map((row) => [row.id as string, row.name as string]));
  const totals = new Map<string, number>();

  for (const payment of payments) {
    if (!RECEIVED.includes(payment.status)) continue;
    const label =
      payment.source === "recovery"
        ? "Rights recovery"
        : payment.source === "checkout"
          ? "Direct licenses"
          : (buyerNames.get(payment.buyerId ?? "") ?? "Other");
    totals.set(label, (totals.get(label) ?? 0) + payment.net.minor);
  }

  return [...totals.entries()]
    .map(([label, minor]) => ({ label, amount: money(minor, "USD") }))
    .sort((a, b) => b.amount.minor - a.amount.minor);
}

/** Earnings per asset, from the view rather than a stored counter. */
export async function getAssetEarnings(
  organizationId: Id,
  assetIds?: readonly Id[],
  client?: SupabaseClient,
): Promise<Map<string, Money>> {
  const supabase = client ?? (await createClient());
  let query = supabase
    .from("asset_lifetime_earnings")
    .select("asset_id, lifetime_earnings_minor, currency")
    .eq("organization_id", organizationId);

  if (assetIds && assetIds.length > 0) query = query.in("asset_id", [...assetIds]);

  const { data } = await query;
  return new Map(
    (data ?? []).map((row) => [
      row.asset_id as string,
      money(Number(row.lifetime_earnings_minor ?? 0), (row.currency as "USD") ?? "USD"),
    ]),
  );
}
