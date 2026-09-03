import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BuyerRequest } from "@/lib/domain";

/**
 * Record the win, and the promises it is not allowed to make.
 *
 * The act is suggest -> explain -> confirm with a person at every step: the
 * choices are the workspace's own licenses with their money on them, the
 * explanation says the move closes the request permanently, and nothing
 * submits without the license chosen and the confirmation ticked. Losing any
 * of that should fail a test rather than a reviewer.
 */

const submitted: FormData[] = [];

vi.mock("../actions", () => ({
  connectLicenseAction: vi.fn(
    async (_workspaceSlug: string, _previous: unknown, form: FormData) => {
      submitted.push(form);
      return {};
    },
  ),
}));

const { WonPanel } = await import("./won-panel");

function request(overrides: Partial<BuyerRequest> = {}): BuyerRequest {
  return {
    id: "a0000000-0000-0000-0000-0000000000d1",
    organizationId: "aaaaaaaa-0000-0000-0000-000000000001",
    createdBy: "11111111-1111-1111-1111-111111111111",
    reference: "REQ-0903-4417",
    source: "manual",
    requestType: "archive",
    status: "negotiating",
    title: "Anything from the Chelsea departure?",
    subjectNames: [],
    topics: [],
    requestedFormats: [],
    budgetDisclosed: false,
    currency: "USD",
    createdAt: "2026-09-01T09:00:00Z",
    updatedAt: "2026-09-01T09:00:00.123456+00:00",
    hasSensitiveNote: false,
    ...overrides,
  };
}

const LICENSES = [
  { id: "a0000000-0000-0000-0000-00000000b001", label: "The City Paper — $640 (active)" },
] as const;

const BASE = {
  workspaceSlug: "hale-studio",
  moneyHref: "/hale-studio/money",
  licenses: LICENSES,
};

beforeEach(() => {
  submitted.length = 0;
});

describe("the basis on screen", () => {
  it("names each license with its money, and promises no matching", () => {
    render(<WonPanel {...BASE} request={request()} />);

    expect(screen.getByRole("option", { name: /the city paper — \$640/i })).toBeInTheDocument();
    expect(screen.getByText(/nothing is suggested or matched for you/i)).toBeInTheDocument();
  });

  it("says what the act does and does not do", () => {
    render(<WonPanel {...BASE} request={request()} />);

    expect(screen.getByText(/performs the move to/i)).toBeInTheDocument();
    expect(screen.getByText(/the buyer is not told/i)).toBeInTheDocument();
  });
});

describe("confirmation", () => {
  it("keeps the submit control unusable until a license is chosen", () => {
    render(<WonPanel {...BASE} request={request()} />);
    expect(screen.getByRole("button", { name: /record the win/i })).toBeDisabled();
    expect(screen.queryByLabelText(/closes it permanently/i)).not.toBeInTheDocument();
  });

  it("asks for the closing confirmation once a license is chosen", async () => {
    const user = userEvent.setup();
    render(<WonPanel {...BASE} request={request()} />);

    await user.selectOptions(screen.getByLabelText(/license that closed it/i), LICENSES[0].id);
    expect(screen.getByLabelText(/closes it permanently/i)).toBeInTheDocument();
  });

  it("sends the license, the confirmation, and the version being edited", async () => {
    const user = userEvent.setup();
    render(<WonPanel {...BASE} request={request()} />);

    await user.selectOptions(screen.getByLabelText(/license that closed it/i), LICENSES[0].id);
    await user.click(screen.getByLabelText(/closes it permanently/i));
    await user.click(screen.getByRole("button", { name: /record the win/i }));

    expect(submitted).toHaveLength(1);
    const form = submitted[0];
    expect(form.get("licenseId")).toBe(LICENSES[0].id);
    expect(form.get("requestId")).toBe(request().id);
    expect(form.get("confirmed")).toBe("yes");
    // The optimistic-concurrency guard, same as every other request control.
    expect(form.get("expectedUpdatedAt")).toBe(request().updatedAt);
  });
});

describe("with nothing to connect", () => {
  it("points at the money screen instead of offering an empty picker", () => {
    render(<WonPanel {...BASE} licenses={[]} request={request()} />);

    expect(screen.queryByLabelText(/license that closed it/i)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /money/i })).toHaveAttribute(
      "href",
      "/hale-studio/money",
    );
  });
});
