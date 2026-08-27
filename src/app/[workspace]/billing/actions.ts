"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createStripeProvider } from "@/lib/billing/stripe";
import { BillingNotConfiguredError } from "@/lib/billing/provider";
import { firstChargeAt, planChangeEffect, type BillingState } from "@/lib/billing";
import { getStorageUsage } from "@/lib/data/subscription";
import { listWorkspaceMembers } from "@/lib/data/workspace";
import type { BillingPeriod, PlanId } from "@/lib/pricing";
import { requireWorkspaceContext } from "@/lib/session-context";
import type { Workspace } from "@/lib/auth";

export interface CheckoutState {
  readonly error?: string;
  readonly warnings?: readonly string[];
  readonly needsConfirmation?: boolean;
}

const SELF_SERVE: readonly PlanId[] = ["solo", "pro", "studio"];

function billingStateFrom(workspace: Workspace): BillingState {
  return {
    plan: workspace.plan as PlanId,
    status: workspace.subscriptionStatus,
    billingPeriod: workspace.billingPeriod ?? "annual",
    trialEndsAt: workspace.trialEndsAt,
    paymentMethodAttachedAt: workspace.paymentMethodAttachedAt,
    pastDueSince: workspace.pastDueSince,
    currentPeriodEnd: workspace.currentPeriodEnd,
    cancelAtPeriodEnd: workspace.cancelAtPeriodEnd,
  };
}

async function originFrom(): Promise<string> {
  const headerList = await headers();
  const host = headerList.get("host");
  const proto =
    headerList.get("x-forwarded-proto") ?? (host?.includes("localhost") ? "http" : "https");
  return headerList.get("origin") ?? (host ? `${proto}://${host}` : "http://localhost:3000");
}

/**
 * Start checkout for a plan.
 *
 * A downgrade, or a change that would strand storage or people, comes back for
 * confirmation before anything is sent to the provider. Nothing about the
 * workspace changes here: the plan follows from a completed payment, and the
 * database refuses to let it be set any other way.
 */
export async function startCheckoutAction(
  workspaceSlug: string,
  _previous: CheckoutState,
  formData: FormData,
): Promise<CheckoutState> {
  const plan = String(formData.get("plan") ?? "") as PlanId;
  const period = (String(formData.get("billingPeriod") ?? "annual") || "annual") as BillingPeriod;
  const confirmed = formData.get("confirmed") === "yes";

  if (!SELF_SERVE.includes(plan)) {
    return { error: "Choose Solo, Pro, or Studio. Agency pricing is arranged directly." };
  }

  const { session, organizationId } = await requireWorkspaceContext(workspaceSlug, "workspace.settings");
  const workspace = session.activeWorkspace;
  const state = billingStateFrom(workspace);

  const [usage, members] = await Promise.all([
    getStorageUsage(organizationId),
    listWorkspaceMembers(organizationId),
  ]);

  const effect = planChangeEffect(state, plan, {
    storageBytes: usage.bytesUsed,
    seats: members.filter((person) => person.status !== "suspended").length,
  });

  if (effect.needsConfirmation && !confirmed) {
    return { needsConfirmation: true, warnings: effect.warnings };
  }

  const provider = createStripeProvider();
  if (!provider.isConfigured()) {
    return {
      error:
        "Billing is not connected yet. Nothing was charged. Ask an administrator to finish setting up payments.",
    };
  }

  const origin = await originFrom();

  let url: string;
  try {
    const checkout = await provider.createCheckoutSession({
      organizationId,
      organizationName: workspace.name,
      plan,
      billingPeriod: period,
      customerEmail: session.email,
      // The first charge waits for the trial to finish.
      firstChargeAt: firstChargeAt(state, new Date()),
      successUrl: `${origin}/settings?checkout=complete`,
      cancelUrl: `${origin}/settings?checkout=cancelled`,
    });
    url = checkout.url;
  } catch (error) {
    if (error instanceof BillingNotConfiguredError) {
      return { error: "Billing is not fully configured. Nothing was charged." };
    }
    return {
      error: error instanceof Error ? error.message : "Could not start checkout.",
    };
  }

  redirect(url);
}

/** Send an existing customer to the provider's own billing screen. */
export async function openBillingPortalAction(
  workspaceSlug: string,): Promise<void> {
  const { session } = await requireWorkspaceContext(workspaceSlug, "workspace.settings");
  const provider = createStripeProvider();
  if (!provider.isConfigured()) return;

  const customerId = session.activeWorkspace.stripeCustomerId;
  if (!customerId) return;

  const origin = await originFrom();
  const portal = await provider.createPortalSession(customerId, `${origin}/settings`);
  redirect(portal.url);
}
