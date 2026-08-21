/**
 * The billing provider contract.
 *
 * Mastline talks to a payment provider through this and nothing else, so the
 * provider is swappable and the lifecycle rules in src/lib/billing.ts stay
 * testable without one in the room.
 *
 * Stripe was chosen over a merchant of record for control and because Stripe
 * Connect is the natural fit for Sales Engine payouts later. The consequence is
 * that Mastline is the seller of record and owns VAT and sales tax registration
 * in every jurisdiction it sells into -- a business obligation, not something
 * this interface can carry.
 */

import type { BillingPeriod, PlanId } from "../pricing";
import type { SubscriptionStatus } from "../subscription";

export interface CheckoutRequest {
  readonly organizationId: string;
  readonly organizationName: string;
  readonly plan: PlanId;
  readonly billingPeriod: BillingPeriod;
  readonly customerEmail: string;
  /** Existing provider customer, when this workspace has paid before. */
  readonly customerId?: string;
  /**
   * When the first charge should land. A trial with days left bills at the end
   * of it, so choosing to pay early never costs anyone.
   */
  readonly firstChargeAt: string;
  readonly successUrl: string;
  readonly cancelUrl: string;
}

export interface CheckoutSession {
  readonly url: string;
  readonly sessionId: string;
}

/** What a provider event means, once translated out of provider vocabulary. */
export interface BillingEvent {
  readonly eventId: string;
  readonly organizationId?: string;
  readonly customerId?: string;
  readonly subscriptionId?: string;
  readonly kind:
    | "subscription_started"
    | "subscription_updated"
    | "payment_succeeded"
    | "payment_failed"
    | "subscription_cancelled"
    | "unhandled";
  readonly plan?: PlanId;
  readonly billingPeriod?: BillingPeriod;
  readonly status?: SubscriptionStatus;
  readonly currentPeriodEnd?: string;
  readonly cancelAtPeriodEnd?: boolean;
  readonly hasPaymentMethod?: boolean;
}

export interface BillingProvider {
  readonly name: string;
  /** True when the provider is configured. False means billing is unavailable. */
  isConfigured(): boolean;
  createCheckoutSession(request: CheckoutRequest): Promise<CheckoutSession>;
  /** A link to the provider's own billing management screen. */
  createPortalSession(customerId: string, returnUrl: string): Promise<{ url: string }>;
  verifyWebhook(body: string, signature: string | null): Promise<boolean>;
  parseWebhook(body: string): BillingEvent | null;
}

export class BillingNotConfiguredError extends Error {
  constructor(provider: string) {
    super(
      `${provider} is not configured. Set the billing environment variables before taking payments.`,
    );
    this.name = "BillingNotConfiguredError";
  }
}
