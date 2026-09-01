import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Recording what a buyer asked for.
 *
 * Two properties matter more than the field list, and both are the kind that
 * survive a refactor only if a test holds them:
 *
 *   1. Every field but the title is optional, and an untouched field is sent as
 *      nothing rather than as a default. A desk that said nothing about
 *      territory has not asked for worldwide, and a desk that mentioned no
 *      money has not offered zero.
 *   2. The form never claims to have contacted anybody, because it has not.
 *
 * The Server Action is a network boundary and is mocked. What it does with what
 * this form sends is tested against the real database and the real policies in
 * tests/buyer-requests.test.ts; what the form SENDS is tested here.
 */

const submitted: FormData[] = [];

vi.mock("../actions", () => ({
  createRequestAction: vi.fn(async (_workspaceSlug: string, _previous: unknown, form: FormData) => {
    submitted.push(form);
    return {};
  }),
  updateRequestAction: vi.fn(async () => ({})),
}));

vi.mock("@/app/buyer-actions", () => ({
  createBuyerAction: vi.fn(async () => ({ ok: true })),
}));

const { RequestForm } = await import("./request-form");

const BASE = {
  workspaceSlug: "hale-studio",
  buyers: [{ id: "a0000000-0000-0000-0000-0000000000b1", name: "Backgrid" }],
  canCreateBuyer: true,
  canSeeSourceNote: true,
};

beforeEach(() => {
  submitted.length = 0;
  window.localStorage.clear();
});

async function submit(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /^record request$/i }));
  await waitFor(() => expect(submitted.length).toBeGreaterThan(0));
  return submitted[0];
}

describe("what the form asks for", () => {
  it("requires a title and nothing else", async () => {
    const user = userEvent.setup();
    render(<RequestForm {...BASE} />);

    expect(screen.getByLabelText(/^title/i)).toBeRequired();
    for (const label of [/^brief$/i, /^territory$/i, /^duration$/i, /^exclusivity$/i]) {
      expect(screen.getByLabelText(label)).not.toBeRequired();
    }

    await user.type(screen.getByLabelText(/^title/i), "Chelsea departure, anything?");
    const form = await submit(user);
    expect(form.get("title")).toBe("Chelsea departure, anything?");
  });

  it("sends unstated commercial terms as empty, never as a default", async () => {
    const user = userEvent.setup();
    render(<RequestForm {...BASE} />);

    await user.type(screen.getByLabelText(/^title/i), "One line");
    const form = await submit(user);

    // Not "Worldwide", not "Perpetual", not "0". Empty, so the parser records
    // it as undefined and the detail screen says "Not provided".
    for (const field of ["territory", "usageDuration", "exclusivity", "usageMedia"]) {
      expect(form.get(field), field).toBe("");
    }
    expect(form.get("approximateQuantity")).toBe("");
    expect(form.get("budgetDisclosed")).toBeNull();
  });

  it("keeps a stated budget behind a deliberate tick", async () => {
    const user = userEvent.setup();
    render(<RequestForm {...BASE} />);

    expect(screen.getByLabelText(/they stated a budget/i)).not.toBeChecked();
    await user.type(screen.getByLabelText(/^title/i), "One line");
    await user.click(screen.getByLabelText(/they stated a budget/i));
    await user.type(screen.getByLabelText(/^minimum$/i), "0");

    const form = await submit(user);
    // A disclosed zero: the desk said out loud there is no money in it.
    expect(form.get("budgetDisclosed")).toBe("on");
    expect(form.get("budgetMin")).toBe("0");
  });

  it("says an unticked budget means they did not say, not that it is zero", () => {
    render(<RequestForm {...BASE} />);
    expect(screen.getByText(/did not say, which is a different fact/i)).toBeInTheDocument();
  });

  it("carries an idempotency key so a resubmit lands on the same request", async () => {
    const user = userEvent.setup();
    render(<RequestForm {...BASE} />);

    await user.type(screen.getByLabelText(/^title/i), "One line");
    const form = await submit(user);

    expect(String(form.get("clientToken")).length).toBeGreaterThanOrEqual(8);
  });
});

describe("confidential material", () => {
  it("is offered to a role that can read source notes", () => {
    render(<RequestForm {...BASE} />);
    expect(screen.getByLabelText(/source note/i)).toBeInTheDocument();
    expect(screen.getByText(/only owners and editors can read/i)).toBeInTheDocument();
  });

  it("is absent entirely for a role that cannot", () => {
    render(<RequestForm {...BASE} canSeeSourceNote={false} />);
    expect(screen.queryByLabelText(/source note/i)).not.toBeInTheDocument();
  });
});

describe("what it promises", () => {
  it("states plainly that saving sends nothing", () => {
    render(<RequestForm {...BASE} />);
    expect(
      screen.getByText(/no message, file, or notification reaches the buyer/i),
    ).toBeInTheDocument();
  });

  it("never borrows a verb from the dispatch gate", () => {
    render(<RequestForm {...BASE} />);
    const buttons = screen.getAllByRole("button").map((button) => button.textContent ?? "");
    for (const label of buttons) {
      expect(label).not.toMatch(/\b(send|dispatch|approve|deliver)\b/i);
    }
  });

  it("offers a draft that is saved on the server, not only in this tab", () => {
    render(<RequestForm {...BASE} />);
    expect(screen.getByRole("button", { name: /save as draft/i })).toBeInTheDocument();
  });
});

describe("unsent typing", () => {
  it("survives the form being remounted", async () => {
    const user = userEvent.setup();
    const first = render(<RequestForm {...BASE} />);

    await user.type(screen.getByLabelText(/^title/i), "Half-typed on a kerb");
    first.unmount();

    render(<RequestForm {...BASE} />);
    await waitFor(() =>
      expect(screen.getByLabelText(/^title/i)).toHaveValue("Half-typed on a kerb"),
    );
  });

  it("never restores the idempotency key with it", async () => {
    const user = userEvent.setup();
    const first = render(<RequestForm {...BASE} />);
    await user.type(screen.getByLabelText(/^title/i), "Half-typed");
    first.unmount();

    // Reusing the key would land the next submission on the request the
    // previous attempt already made, which is the opposite of a draft.
    const stored = JSON.parse(
      window.localStorage.getItem("mastline:request-draft:hale-studio") ?? "{}",
    ) as Record<string, string>;
    expect(stored.clientToken).toBeUndefined();
    expect(stored.title).toBe("Half-typed");
  });

  it("is kept per workspace, so two studios cannot pour into each other", async () => {
    const user = userEvent.setup();
    const first = render(<RequestForm {...BASE} />);
    await user.type(screen.getByLabelText(/^title/i), "Belongs to Hale");
    first.unmount();

    render(<RequestForm {...BASE} workspaceSlug="northline" />);
    await waitFor(() => expect(screen.getByLabelText(/^title/i)).toHaveValue(""));
  });

  it("is not poured over a request being edited", async () => {
    const user = userEvent.setup();
    const first = render(<RequestForm {...BASE} />);
    await user.type(screen.getByLabelText(/^title/i), "A different request entirely");
    first.unmount();

    render(
      <RequestForm
        {...BASE}
        request={{
          id: "a0000000-0000-0000-0000-0000000000d1",
          organizationId: "aaaaaaaa-0000-0000-0000-000000000001",
          createdBy: "11111111-1111-1111-1111-111111111111",
          reference: "REQ-0828-4417",
          source: "manual",
          requestType: "archive",
          status: "new",
          title: "What the record actually says",
          subjectNames: [],
          topics: [],
          requestedFormats: [],
          budgetDisclosed: false,
          currency: "USD",
          createdAt: "2026-08-28T09:00:00Z",
          updatedAt: "2026-08-28T09:00:00Z",
          hasSensitiveNote: false,
        }}
      />,
    );

    expect(screen.getByLabelText(/^title/i)).toHaveValue("What the record actually says");
  });
});

describe("editing", () => {
  const REQUEST = {
    id: "a0000000-0000-0000-0000-0000000000d1",
    organizationId: "aaaaaaaa-0000-0000-0000-000000000001",
    createdBy: "11111111-1111-1111-1111-111111111111",
    reference: "REQ-0828-4417",
    source: "manual" as const,
    requestType: "archive" as const,
    status: "new" as const,
    title: "Chelsea departure",
    subjectNames: [],
    topics: [],
    requestedFormats: [],
    budgetDisclosed: false,
    currency: "USD" as const,
    createdAt: "2026-08-28T09:00:00Z",
    updatedAt: "2026-08-28T09:00:00.123456+00:00",
    hasSensitiveNote: false,
  };

  it("carries the version being edited, so a concurrent save cannot be lost", () => {
    const { container } = render(<RequestForm {...BASE} request={REQUEST} />);
    const field = container.querySelector('input[name="expectedUpdatedAt"]');
    expect(field).toHaveValue(REQUEST.updatedAt);
  });

  it("does not offer a second draft button on a request that already exists", () => {
    render(<RequestForm {...BASE} request={REQUEST} />);
    expect(screen.queryByRole("button", { name: /save as draft/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /save changes/i })).toBeInTheDocument();
  });
});

describe("accessibility", () => {
  it("binds every control to a label", () => {
    const { container } = render(<RequestForm {...BASE} />);

    for (const control of container.querySelectorAll("input, select, textarea")) {
      if (control instanceof HTMLInputElement && control.type === "hidden") continue;
      // A checkbox may be labelled by being wrapped in its <label>.
      const wrapped = control.closest("label") !== null;
      const id = control.getAttribute("id");
      const labelled =
        wrapped ||
        (id !== null && container.querySelector(`label[for="${id}"]`) !== null) ||
        control.getAttribute("aria-label") !== null;
      expect(labelled, control.outerHTML.slice(0, 120)).toBe(true);
    }
  });

  it("gives every section a heading the form is grouped under", () => {
    render(<RequestForm {...BASE} />);
    for (const heading of [
      /what they asked for/i,
      /when and where/i,
      /deliverables/i,
      /commercial terms/i,
      /delivery and restrictions/i,
    ]) {
      expect(screen.getByRole("heading", { name: heading })).toBeInTheDocument();
    }
  });
});
