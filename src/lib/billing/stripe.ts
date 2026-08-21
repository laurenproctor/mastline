import type { BillingEvent, BillingProvider, CheckoutRequest, CheckoutSession } from "./provider";
import { BillingNotConfiguredError } from "./provider";
import type { BillingPeriod, PlanId } from "../pricing";
import { timingSafeEqual } from "../webhook";

/**
 * Stripe, spoken to over its REST API.
 *
 * Deliberately no SDK. The surface Mastline needs is three endpoints and a
 * signature check, and a dependency that ships its own HTTP client, retry
 * policy, and types for the whole of Stripe is a poor trade for that.
 *
 * Price identifiers are configuration, not code: a plan's Stripe price is set
 * in the dashboard and referenced by an environment variable, so changing what
 * a plan costs never means changing this file.
 */

function priceIdFor(plan: PlanId, period: BillingPeriod): string | undefined {
  return process.env[`STRIPE_PRICE_${plan.toUpperCase()}_${period.toUpperCase()}`];
}

const SELF_SERVE_PLANS: readonly PlanId[] = ["solo", "pro", "studio"];
const PERIODS: readonly BillingPeriod[] = ["annual", "monthly"];

/**
 * Work out which plan a Stripe price refers to.
 *
 * Stripe events carry a price, not a Mastline plan, so without this a workspace
 * that subscribed to Studio would stay on whatever plan it had before. The
 * mapping is the same environment configuration used to create the checkout,
 * read in reverse.
 */
export function planForPrice(
  priceId: string | undefined,
): { plan: PlanId; period: BillingPeriod } | null {
  if (!priceId) return null;
  for (const plan of SELF_SERVE_PLANS) {
    for (const period of PERIODS) {
      if (priceIdFor(plan, period) === priceId) return { plan, period };
    }
  }
  return null;
}

/** The price a subscription or invoice line refers to, wherever Stripe put it. */
function priceFromObject(object: Record<string, unknown>): string | undefined {
  const items = (object.items as { data?: Record<string, unknown>[] } | undefined)?.data;
  const fromSubscription = items?.[0]?.price as { id?: string } | undefined;
  if (fromSubscription?.id) return fromSubscription.id;

  const lines = (object.lines as { data?: Record<string, unknown>[] } | undefined)?.data;
  const fromInvoice = lines?.[0]?.price as { id?: string } | undefined;
  return fromInvoice?.id;
}

function secretKey(): string | undefined {
  return process.env.STRIPE_SECRET_KEY;
}

async function stripeRequest(
  path: string,
  form: Record<string, string | undefined>,
): Promise<Record<string, unknown>> {
  const key = secretKey();
  if (!key) throw new BillingNotConfiguredError("Stripe");

  const body = new URLSearchParams();
  for (const [name, value] of Object.entries(form)) {
    if (value !== undefined) body.set(name, value);
  }

  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  const json = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    const error = json.error as { message?: string } | undefined;
    throw new Error(`Stripe: ${error?.message ?? response.statusText}`);
  }
  return json;
}

/**
 * Verify a Stripe webhook signature.
 *
 * The header carries a timestamp and one or more signatures. The timestamp is
 * checked against a tolerance so a captured request cannot be replayed later,
 * and the comparison is constant time.
 */
export async function verifyStripeSignature(
  body: string,
  header: string | null,
  secret: string,
  now: Date = new Date(),
  toleranceSeconds = 300,
): Promise<boolean> {
  if (!header) return false;

  const parts = Object.fromEntries(
    header.split(",").map((piece) => {
      const [name, ...rest] = piece.trim().split("=");
      return [name, rest.join("=")];
    }),
  );

  const timestamp = Number(parts.t);
  if (!Number.isFinite(timestamp)) return false;

  const age = Math.abs(now.getTime() / 1000 - timestamp);
  if (age > toleranceSeconds) return false;

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(`${timestamp}.${body}`));
  const expected = [...new Uint8Array(signature)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

  // Stripe may send several v1 signatures during a secret rotation.
  const provided = header
    .split(",")
    .map((piece) => piece.trim())
    .filter((piece) => piece.startsWith("v1="))
    .map((piece) => piece.slice(3));

  return provided.some((candidate) => timingSafeEqual(expected, candidate));
}

const STATUS_MAP: Record<string, BillingEvent["status"]> = {
  trialing: "trialing",
  active: "active",
  past_due: "past_due",
  unpaid: "past_due",
  canceled: "cancelled",
  incomplete_expired: "expired",
};

export function createStripeProvider(): BillingProvider {
  return {
    name: "stripe",

    isConfigured() {
      return Boolean(secretKey() && process.env.STRIPE_WEBHOOK_SECRET);
    },

    async createCheckoutSession(request: CheckoutRequest): Promise<CheckoutSession> {
      const price = priceIdFor(request.plan, request.billingPeriod);
      if (!price) {
        throw new BillingNotConfiguredError(
          `Stripe price for ${request.plan} ${request.billingPeriod}`,
        );
      }

      // Billing starts when the trial ends, so an early decision to pay never
      // costs the remaining days.
      const trialEnd = Math.floor(new Date(request.firstChargeAt).getTime() / 1000);
      const now = Math.floor(Date.now() / 1000);

      const session = await stripeRequest("checkout/sessions", {
        mode: "subscription",
        "line_items[0][price]": price,
        "line_items[0][quantity]": "1",
        success_url: request.successUrl,
        cancel_url: request.cancelUrl,
        customer: request.customerId,
        customer_email: request.customerId ? undefined : request.customerEmail,
        client_reference_id: request.organizationId,
        "metadata[organization_id]": request.organizationId,
        // The checkout session object does not carry the price, so the plan
        // travels in metadata and on the subscription it creates.
        "metadata[plan]": request.plan,
        "metadata[billing_period]": request.billingPeriod,
        "subscription_data[metadata][organization_id]": request.organizationId,
        "subscription_data[metadata][plan]": request.plan,
        "subscription_data[metadata][billing_period]": request.billingPeriod,
        "subscription_data[trial_end]": trialEnd > now + 60 ? String(trialEnd) : undefined,
        allow_promotion_codes: "true",
      });

      return { url: session.url as string, sessionId: session.id as string };
    },

    async createPortalSession(customerId: string, returnUrl: string) {
      const session = await stripeRequest("billing_portal/sessions", {
        customer: customerId,
        return_url: returnUrl,
      });
      return { url: session.url as string };
    },

    async verifyWebhook(body: string, signature: string | null) {
      const secret = process.env.STRIPE_WEBHOOK_SECRET;
      if (!secret) return false;
      return verifyStripeSignature(body, signature, secret);
    },

    parseWebhook(body: string): BillingEvent | null {
      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(body) as Record<string, unknown>;
      } catch {
        return null;
      }
      return translateStripeEvent(payload);
    },
  };
}

/** Turn a Stripe event into something the lifecycle rules understand. */
export function translateStripeEvent(payload: Record<string, unknown>): BillingEvent | null {
  const eventId = typeof payload.id === "string" ? payload.id : "";
  const type = typeof payload.type === "string" ? payload.type : "";
  if (!eventId || !type) return null;

  const object = (payload.data as { object?: Record<string, unknown> } | undefined)?.object ?? {};
  const metadata = (object.metadata as Record<string, string> | undefined) ?? {};
  const organizationId =
    metadata.organization_id ??
    (typeof object.client_reference_id === "string" ? object.client_reference_id : undefined);

  const base = {
    eventId,
    organizationId,
    customerId: typeof object.customer === "string" ? object.customer : undefined,
  };

  const periodEnd =
    typeof object.current_period_end === "number"
      ? new Date(object.current_period_end * 1000).toISOString()
      : undefined;

  // Metadata first, because a checkout session carries no price at all.
  const priced =
    metadata.plan && SELF_SERVE_PLANS.includes(metadata.plan as PlanId)
      ? {
          plan: metadata.plan as PlanId,
          period: (metadata.billing_period as BillingPeriod) ?? "annual",
        }
      : planForPrice(priceFromObject(object));

  switch (type) {
    case "checkout.session.completed":
      return {
        ...base,
        subscriptionId: typeof object.subscription === "string" ? object.subscription : undefined,
        kind: "subscription_started",
        plan: priced?.plan,
        billingPeriod: priced?.period,
        hasPaymentMethod: true,
      };

    case "customer.subscription.created":
    case "customer.subscription.updated":
      return {
        ...base,
        subscriptionId: typeof object.id === "string" ? object.id : undefined,
        kind: "subscription_updated",
        plan: priced?.plan,
        billingPeriod: priced?.period,
        status: STATUS_MAP[String(object.status)] ?? undefined,
        currentPeriodEnd: periodEnd,
        cancelAtPeriodEnd: Boolean(object.cancel_at_period_end),
      };

    case "customer.subscription.deleted":
      return {
        ...base,
        subscriptionId: typeof object.id === "string" ? object.id : undefined,
        kind: "subscription_cancelled",
        status: "cancelled",
      };

    case "invoice.paid":
    case "invoice.payment_succeeded":
      return {
        ...base,
        subscriptionId: typeof object.subscription === "string" ? object.subscription : undefined,
        kind: "payment_succeeded",
        plan: priced?.plan,
        billingPeriod: priced?.period,
        status: "active",
      };

    case "invoice.payment_failed":
      return {
        ...base,
        subscriptionId: typeof object.subscription === "string" ? object.subscription : undefined,
        kind: "payment_failed",
        status: "past_due",
      };

    default:
      return { ...base, kind: "unhandled" };
  }
}
