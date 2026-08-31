import { NextResponse } from "next/server";
import { createStripeProvider } from "@/lib/billing/stripe";
import { PermissionError } from "@/lib/permissions";
import { requireWorkspaceContext } from "@/lib/session-context";
import { workspaceRoutes } from "@/lib/workspace-routes";

/**
 * Redirect to the provider's own billing screen.
 *
 * Card details, invoices, and cancellation live there rather than being rebuilt
 * here: a payment provider's portal is PCI-compliant and Mastline never touches
 * a card number.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ workspace: string }> },
) {
  const { workspace } = await params;
  try {
    const { session, canonicalSlug } = await requireWorkspaceContext(
      workspace,
      "workspace.settings",
    );
    const customerId = session.activeWorkspace.stripeCustomerId;

    if (!customerId) {
      return NextResponse.redirect(
        new URL(workspaceRoutes(canonicalSlug).settings(), request.url),
        { status: 303 },
      );
    }

    const provider = createStripeProvider();
    if (!provider.isConfigured()) {
      return NextResponse.redirect(
        new URL(workspaceRoutes(canonicalSlug).settings(), request.url),
        { status: 303 },
      );
    }

    const origin = new URL(request.url).origin;
    const portal = await provider.createPortalSession(
      customerId,
      `${origin}/${canonicalSlug}/settings`,
    );
    return NextResponse.redirect(portal.url, { status: 303 });
  } catch (error) {
    if (error instanceof PermissionError) {
      return NextResponse.json({ error: "Only an owner can manage billing." }, { status: 403 });
    }
    throw error;
  }
}
