import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A buyer that does not exist yet must not stop the work.
 *
 * These cover the two things that make the inline form safe to put inside
 * another form: the picker never submits its own sentinel value, and adding a
 * buyer does not submit the brief or package around it.
 */

const created: { name: string; buyerType: string }[] = [];
let nextResult: { ok: boolean; id?: string; name?: string; existed?: boolean; error?: string } = {
  ok: true,
  id: "buyer-new",
  name: "Backgrid",
};

vi.mock("@/app/buyer-actions", () => ({
  createBuyerAction: vi.fn(
    async (_workspaceSlug: string, input: { name: string; buyerType: string }) => {
      created.push({ name: input.name, buyerType: input.buyerType });
      return nextResult;
    },
  ),
}));

const { BuyerSelect, BuyerCheckboxes } = await import("./buyer-select");

const BUYERS = [
  { id: "buyer-1", name: "Getty" },
  { id: "buyer-2", name: "The Sun" },
];

beforeEach(() => {
  created.length = 0;
  nextResult = { ok: true, id: "buyer-new", name: "Backgrid" };
});

const hiddenValue = () =>
  document.querySelector<HTMLInputElement>('input[type="hidden"][name="buyerId"]')!.value;

describe("BuyerSelect", () => {
  it("offers the buyers already recorded", () => {
    render(<BuyerSelect workspaceSlug="marcus-hale-studio" buyers={BUYERS} />);
    expect(screen.getByRole("option", { name: "Getty" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "The Sun" })).toBeInTheDocument();
  });

  it("submits the chosen buyer's id", async () => {
    const user = userEvent.setup();
    render(<BuyerSelect workspaceSlug="marcus-hale-studio" buyers={BUYERS} />);

    await user.selectOptions(screen.getByLabelText(/Buyer/), "buyer-2");
    expect(hiddenValue()).toBe("buyer-2");
  });

  it("never submits the add-new sentinel as if it were a buyer", async () => {
    const user = userEvent.setup();
    render(
      <BuyerSelect workspaceSlug="marcus-hale-studio" buyers={BUYERS} defaultValue="buyer-1" />,
    );

    await user.selectOptions(screen.getByLabelText(/Buyer/), "__add_new__");
    expect(screen.getByLabelText(/Buyer name/)).toBeInTheDocument();
    // The value under the submitted name is untouched by opening the form.
    expect(hiddenValue()).toBe("buyer-1");
  });

  it("creates the buyer and selects it, without submitting the form around it", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault());

    render(
      <form onSubmit={onSubmit}>
        <BuyerSelect workspaceSlug="marcus-hale-studio" buyers={BUYERS} />
      </form>,
    );

    await user.selectOptions(screen.getByLabelText(/Buyer/), "__add_new__");
    await user.type(screen.getByLabelText(/Buyer name/), "Backgrid");
    await user.click(screen.getByRole("button", { name: "Add buyer" }));

    await waitFor(() => expect(created).toEqual([{ name: "Backgrid", buyerType: "agency" }]));
    await waitFor(() => expect(hiddenValue()).toBe("buyer-new"));
    expect(screen.getByRole("option", { name: "Backgrid" })).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("says so when the name was already in the workspace, and selects that one", async () => {
    nextResult = { ok: true, id: "buyer-1", name: "Getty", existed: true };
    const user = userEvent.setup();
    render(<BuyerSelect workspaceSlug="marcus-hale-studio" buyers={BUYERS} />);

    await user.selectOptions(screen.getByLabelText(/Buyer/), "__add_new__");
    await user.type(screen.getByLabelText(/Buyer name/), "Getty");
    await user.click(screen.getByRole("button", { name: "Add buyer" }));

    await waitFor(() => expect(hiddenValue()).toBe("buyer-1"));
    expect(screen.getByRole("status")).toHaveTextContent(/already in this workspace/i);
    // Selected once, not listed twice.
    expect(screen.getAllByRole("option", { name: "Getty" })).toHaveLength(1);
  });

  it("shows what went wrong and keeps the form open", async () => {
    nextResult = { ok: false, error: "Give the buyer a name." };
    const user = userEvent.setup();
    render(<BuyerSelect workspaceSlug="marcus-hale-studio" buyers={BUYERS} />);

    await user.selectOptions(screen.getByLabelText(/Buyer/), "__add_new__");
    await user.type(screen.getByLabelText(/Buyer name/), "x");
    await user.click(screen.getByRole("button", { name: "Add buyer" }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Give the buyer a name."),
    );
    expect(screen.getByLabelText(/Buyer name/)).toBeInTheDocument();
    expect(hiddenValue()).toBe("");
  });

  it("does not offer to create one for a role that may not", () => {
    render(<BuyerSelect workspaceSlug="marcus-hale-studio" buyers={BUYERS} canCreate={false} />);
    expect(screen.queryByRole("option", { name: /Add a new buyer/ })).not.toBeInTheDocument();
  });
});

describe("BuyerCheckboxes", () => {
  it("ticks a buyer added here, because that is why it was added", async () => {
    const user = userEvent.setup();
    render(
      <BuyerCheckboxes workspaceSlug="marcus-hale-studio" buyers={BUYERS} legend="Target buyers" />,
    );

    await user.click(screen.getByRole("button", { name: /Add a buyer/ }));
    await user.type(screen.getByLabelText(/Buyer name/), "Backgrid");
    await user.click(screen.getByRole("button", { name: "Add buyer" }));

    await waitFor(() => expect(screen.getByLabelText("Backgrid")).toBeChecked());
  });

  it("submits every ticked buyer under one name", async () => {
    const user = userEvent.setup();
    render(
      <BuyerCheckboxes workspaceSlug="marcus-hale-studio" buyers={BUYERS} legend="Target buyers" />,
    );

    await user.click(screen.getByLabelText("Getty"));
    await user.click(screen.getByLabelText("The Sun"));

    const ticked = [
      ...document.querySelectorAll<HTMLInputElement>('input[name="targetBuyerIds"]:checked'),
    ].map((input) => input.value);
    expect(ticked).toEqual(["buyer-1", "buyer-2"]);
  });
});
