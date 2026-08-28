import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BuyerRequest, RequestStatus } from "@/lib/domain";

/**
 * The lifecycle controls, and the promises they are not allowed to make.
 *
 * Four things are easy to lose in a refactor and expensive to lose in front of
 * a photographer: that a closed request offers no way back, that lost and
 * declined ask for a reason, that closing takes a deliberate confirmation, and
 * that the version being edited travels with every submission. These are here
 * so losing any of them fails a test rather than a reviewer.
 */

const submitted: FormData[] = [];

vi.mock("../actions", () => ({
  transitionRequestAction: vi.fn(
    async (_workspaceSlug: string, _previous: unknown, form: FormData) => {
      submitted.push(form);
      return {};
    },
  ),
}));

const { LifecyclePanel } = await import("./lifecycle-panel");

function request(overrides: Partial<BuyerRequest> = {}): BuyerRequest {
  return {
    id: "a0000000-0000-0000-0000-0000000000d1",
    organizationId: "aaaaaaaa-0000-0000-0000-000000000001",
    createdBy: "11111111-1111-1111-1111-111111111111",
    reference: "REQ-0828-4417",
    source: "manual",
    requestType: "archive",
    status: "new",
    title: "Anything from the Chelsea departure?",
    subjectNames: [],
    topics: [],
    requestedFormats: [],
    budgetDisclosed: false,
    currency: "USD",
    createdAt: "2026-08-28T09:00:00Z",
    updatedAt: "2026-08-28T09:00:00.123456+00:00",
    hasSensitiveNote: false,
    ...overrides,
  };
}

const BASE = { workspaceSlug: "hale-studio", canWrite: true };

async function choose(status: RequestStatus) {
  const user = userEvent.setup();
  await user.selectOptions(screen.getByLabelText(/move this request to/i), status);
  return user;
}

beforeEach(() => {
  submitted.length = 0;
});

describe("a closed request", () => {
  it.each(["won", "lost", "expired", "declined", "cancelled"] as const)(
    "offers no way to move a %s request",
    (status) => {
      render(
        <LifecyclePanel {...BASE} request={request({ status, closedReason: "Told them no" })} />,
      );

      expect(screen.queryByLabelText(/move this request to/i)).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /record/i })).not.toBeInTheDocument();
      expect(screen.getByText(/cannot be reopened/i)).toBeInTheDocument();
    },
  );

  it("shows the reason that was recorded", () => {
    render(
      <LifecyclePanel
        {...BASE}
        request={request({ status: "lost", closedReason: "Backgrid had it first" })}
      />,
    );
    expect(screen.getByText(/backgrid had it first/i)).toBeInTheDocument();
  });
});

describe("what the control offers", () => {
  it("lists only the states this request can actually reach", async () => {
    render(<LifecyclePanel {...BASE} request={request({ status: "new" })} />);
    const select = screen.getByLabelText(/move this request to/i);

    expect(select).toContainHTML("Qualified");
    // new -> submitted skips qualification entirely, so it is not offered.
    expect(select).not.toContainHTML("Submitted");
  });

  it("never offers a win, and says why rather than leaving a gap", () => {
    render(<LifecyclePanel {...BASE} request={request({ status: "submitted" })} />);

    expect(screen.getByLabelText(/move this request to/i)).not.toContainHTML(">Won<");
    expect(screen.getByText(/connecting this request to a license/i)).toBeInTheDocument();
  });

  it("tells a read-only role where the request is without offering controls", () => {
    render(<LifecyclePanel {...BASE} canWrite={false} request={request()} />);

    expect(screen.queryByLabelText(/move this request to/i)).not.toBeInTheDocument();
    expect(screen.getByText(/read requests but not move them/i)).toBeInTheDocument();
  });

  it("keeps the submit control unusable until a target is chosen", () => {
    render(<LifecyclePanel {...BASE} request={request()} />);
    expect(screen.getByRole("button", { name: /record/i })).toBeDisabled();
  });
});

describe("reasons", () => {
  it.each(["lost", "declined"] as const)("marks the reason required for %s", async (status) => {
    render(<LifecyclePanel {...BASE} request={request({ status: "qualified" })} />);
    await choose(status);

    expect(screen.getByLabelText(/reason/i)).toBeRequired();
  });

  it("leaves the reason optional for a move that does not need one", async () => {
    render(<LifecyclePanel {...BASE} request={request({ status: "new" })} />);
    await choose("qualified");

    expect(screen.getByLabelText(/reason/i)).not.toBeRequired();
  });

  it("distinguishes cancelled from declined in words, not only in a value", async () => {
    render(<LifecyclePanel {...BASE} request={request({ status: "qualified" })} />);

    await choose("cancelled");
    expect(screen.getByText(/buyer withdrew/i)).toBeInTheDocument();

    await choose("declined");
    expect(screen.getByText(/you turned it down/i)).toBeInTheDocument();
  });
});

describe("closing a request", () => {
  it("asks for an explicit confirmation first", async () => {
    render(<LifecyclePanel {...BASE} request={request({ status: "qualified" })} />);
    await choose("cancelled");

    expect(screen.getByLabelText(/cannot be reopened/i)).toBeInTheDocument();
  });

  it("does not ask for one on an ordinary move", async () => {
    render(<LifecyclePanel {...BASE} request={request({ status: "new" })} />);
    await choose("qualified");

    expect(screen.queryByLabelText(/cannot be reopened/i)).not.toBeInTheDocument();
  });

  it("sends the target, the reason, and the version being edited", async () => {
    render(<LifecyclePanel {...BASE} request={request({ status: "qualified" })} />);
    const user = await choose("lost");

    await user.type(screen.getByLabelText(/reason/i), "Backgrid had it first");
    await user.click(screen.getByLabelText(/cannot be reopened/i));
    await user.click(screen.getByRole("button", { name: /^record$/i }));

    expect(submitted).toHaveLength(1);
    const form = submitted[0];
    expect(form.get("status")).toBe("lost");
    expect(form.get("requestId")).toBe(request().id);
    expect(form.get("confirmed")).toBe("yes");
    // The optimistic-concurrency guard. Without it, two people working the same
    // inbox silently overwrite one another.
    expect(form.get("expectedUpdatedAt")).toBe(request().updatedAt);
    expect(String(form.get("reason"))).toMatch(/backgrid/i);
  });
});

describe("what it promises", () => {
  it("says moving a request contacts nobody", () => {
    render(<LifecyclePanel {...BASE} request={request()} />);
    expect(screen.getByText(/the buyer is not told/i)).toBeInTheDocument();
  });
});
