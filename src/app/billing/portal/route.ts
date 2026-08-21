import { NextResponse } from "next/server";
import { createStripeProvider } from "@/lib/billing/stripe";
import { PermissionError } from "@/lib/permissions";
import { requireContext } from "@/lib/session-context";

/**
 * Redirect to the provider's own billing screen.
 *
 * Card details, invoices, and cancellation live there rather than being rebuilt
 * here: a payment provider's portal is PCI-compliant and Mastline never touches
 * a card number.
 */
export async function GET(request: Request) {
  try {
    const { session } = await requireContext("workspace.settings");
    const customerId = session.activeWorkspace.stripeCustomerId;

    if (!customerId) {
      return NextResponse.redirect(new URL("/settings", request.url), { status: 303 });
    }

    const provider = createStripeProvider();
    if (!provider.isConfigured()) {
      return NextResponse.redirect(new URL("/settings", request.url), { status: 303 });
    }

    const origin = new URL(request.url).origin;
    const portal = await provider.createPortalSession(customerId, `${origin}/settings`);
    return NextResponse.redirect(portal.url, { status: 303 });
  } catch (error) {
    if (error instanceof PermissionError) {
      return NextResponse.json({ error: "Only an owner can manage billing." }, { status: 403 });
    }
    throw error;
  }
}
