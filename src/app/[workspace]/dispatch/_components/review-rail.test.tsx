import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Create private delivery keeps the two-motion confirmation the approval gate
 * has always had, and the created state tells the truth about what exists.
 *
 * The three separations under test are the flow's whole honesty contract:
 * creating is not sharing, copying is not sharing, and only the explicit
 * Mark as shared says anything left Mastline.
 */

const created: FormData[] = [];
const shared: FormData[] = [];

vi.mock("../flow-actions", () => ({
  createPrivateDeliveryAction: vi.fn(
    async (_workspaceSlug: string, _previous: unknown, form: FormData) => {
      created.push(form);
      return {};
    },
  ),
  markFlowSharedAction: vi.fn(
    async (_workspaceSlug: string, _previous: unknown, form: FormData) => {
      shared.push(form);
      return {};
    },
  ),
}));

const { ReviewRail } = await import("./review-rail");

const ACCESS = {
  recipientLabel: "New York picture desk",
  contactReference: "desk@example.com",
  windowDays: 14 as const,
  deliveryNote: "Three frames from this morning.",
  allowFullResolution: true,
  requireAcceptanceToView: true,
};

const READY = {
  workspaceSlug: "hale-studio",
  shootId: "shoot-1",
  packageId: "package-1",
  submissionId: undefined,
  approved: false,
  isApprovable: true,
  blockingTitles: [] as string[],
  buyerName: "Northern Wire",
  frameCount: 3,
  terms: "One-time editorial, worldwide",
  restrictions: "Editorial use only. No commercial use.",
  access: ACCESS,
  link: null,
};

beforeEach(() => {
  created.length = 0;
  shared.length = 0;
});

describe("creating the private delivery keeps its own confirmation", () => {
  it("does not create on the first press, and says what the act does", async () => {
    const user = userEvent.setup();
    render(<ReviewRail {...READY} />);

    expect(
      screen.getByText(/Creates the immutable package and tracked recipient link/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Nothing is shared yet/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /create private delivery/i }));
    expect(created).toHaveLength(0);
    expect(
      screen.getByRole("button", { name: /yes, create the private delivery/i }),
    ).toBeInTheDocument();
  });

  it("names what becomes permanent before it commits, then carries the confirmation", async () => {
    const user = userEvent.setup();
    render(<ReviewRail {...READY} />);

    await user.click(screen.getByRole("button", { name: /create private delivery/i }));
    expect(screen.getByText("Northern Wire")).toBeInTheDocument();
    expect(screen.getByText("One-time editorial, worldwide")).toBeInTheDocument();
    expect(screen.getByText(/this becomes permanent/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /yes, create the private delivery/i }));
    expect(created).toHaveLength(1);
    expect(created[0].get("confirmed")).toBe("yes");
    expect(created[0].get("packageId")).toBe("package-1");
    expect(created[0].get("requireAcceptanceToView")).toBe("1");
    expect(created[0].get("windowDays")).toBe("14");
  });

  it("lets the second thoughts win", async () => {
    const user = userEvent.setup();
    render(<ReviewRail {...READY} />);

    await user.click(screen.getByRole("button", { name: /create private delivery/i }));
    await user.click(screen.getByRole("button", { name: /go back/i }));

    expect(created).toHaveLength(0);
    expect(screen.getByRole("button", { name: /create private delivery/i })).toBeInTheDocument();
  });

  it("stays disabled while any check is blocking", () => {
    render(<ReviewRail {...READY} isApprovable={false} blockingTitles={["Captions"]} />);
    expect(screen.getByRole("button", { name: /create private delivery/i })).toBeDisabled();
    expect(screen.getByText(/captions/i)).toBeInTheDocument();
  });
});

describe("the created state tells the truth", () => {
  const CREATED = {
    ...READY,
    approved: true,
    submissionId: "submission-1",
    link: {
      id: "delivery-1",
      url: "https://mastline.test/d/token-abc",
      expiresAt: "2026-09-13T00:00:00Z",
      sharedAt: undefined,
    },
  };

  it("says created, not sent, and shows the real access facts", () => {
    render(<ReviewRail {...CREATED} />);

    expect(screen.getByText("Private delivery created")).toBeInTheDocument();
    expect(screen.getByText(/It has not been shared/)).toBeInTheDocument();
    expect(screen.getByText(/Waits for the terms to be accepted/)).toBeInTheDocument();
    expect(screen.getByText(/previews carry the recipient/)).toBeInTheDocument();
    expect(screen.queryByText(/has been sent/i)).not.toBeInTheDocument();
  });

  it("copying is not sharing, and the copy control says so before it is pressed", () => {
    render(<ReviewRail {...CREATED} />);
    expect(screen.getByText(/Copying writes nothing to the delivery record/)).toBeInTheDocument();
    expect(shared).toHaveLength(0);
  });

  it("marking as shared is its own explicit act, aimed at this link", async () => {
    const user = userEvent.setup();
    render(<ReviewRail {...CREATED} />);

    expect(screen.getByText(/after you have sent the link to the recipient/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /mark as shared/i }));
    expect(shared).toHaveLength(1);
    expect(shared[0].get("deliveryId")).toBe("delivery-1");
    expect(shared[0].get("submissionId")).toBe("submission-1");
  });
});
