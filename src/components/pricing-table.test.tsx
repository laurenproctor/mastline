import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { PricingTable } from "./pricing-table";

/** The plan card whose heading matches `name`. */
function cardFor(name: string): HTMLElement {
  const card = screen
    .getAllByRole("article")
    .find((article) => within(article).queryByRole("heading", { name, level: 2 }));
  if (!card) throw new Error(`No plan card found for "${name}"`);
  return card;
}

describe("billing toggle", () => {
  it("defaults to annual", () => {
    render(<PricingTable />);
    expect(screen.getByRole("button", { name: /annual/i })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /^monthly$/i })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("shows the annual prices by default", () => {
    render(<PricingTable />);
    expect(within(cardFor("Solo")).getByText("49")).toBeInTheDocument();
    expect(within(cardFor("Pro")).getByText("99")).toBeInTheDocument();
    expect(within(cardFor("Studio")).getByText("279")).toBeInTheDocument();
  });

  it("switches every non-custom plan to monthly", async () => {
    const user = userEvent.setup();
    render(<PricingTable />);
    await user.click(screen.getByRole("button", { name: /^monthly$/i }));

    expect(within(cardFor("Solo")).getByText("59")).toBeInTheDocument();
    expect(within(cardFor("Pro")).getByText("119")).toBeInTheDocument();
    expect(within(cardFor("Studio")).getByText("339")).toBeInTheDocument();
    expect(within(cardFor("Agency")).getByText("Custom")).toBeInTheDocument();
  });

  it("does not change any plan's features when the period changes", async () => {
    const user = userEvent.setup();
    render(<PricingTable />);
    const before = within(cardFor("Pro"))
      .getAllByRole("listitem")
      .map((item) => item.textContent);

    await user.click(screen.getByRole("button", { name: /^monthly$/i }));
    const after = within(cardFor("Pro"))
      .getAllByRole("listitem")
      .map((item) => item.textContent);

    expect(after).toEqual(before);
  });

  it("shows the annual total only under annual billing", async () => {
    const user = userEvent.setup();
    render(<PricingTable />);
    expect(screen.getByText(/\$588 billed once a year/)).toBeInTheDocument();
    expect(screen.getByText(/\$1,188 billed once a year/)).toBeInTheDocument();
    expect(screen.getByText(/\$3,348 billed once a year/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^monthly$/i }));
    expect(screen.queryByText(/billed once a year/)).not.toBeInTheDocument();
  });

  it("is operable by keyboard", async () => {
    const user = userEvent.setup();
    render(<PricingTable />);
    const monthly = screen.getByRole("button", { name: /^monthly$/i });
    monthly.focus();
    await user.keyboard("{Enter}");
    expect(monthly).toHaveAttribute("aria-pressed", "true");
  });
});

describe("approved pricing presentation", () => {
  it("claims no more than 18% saving", () => {
    render(<PricingTable />);
    expect(screen.getByText("Save up to 18%")).toBeInTheDocument();
  });

  it("marks Pro as the only most-popular plan", () => {
    render(<PricingTable />);
    expect(screen.getAllByText("Most popular")).toHaveLength(1);
    expect(within(cardFor("Pro")).getByText("Most popular")).toBeInTheDocument();
  });

  it("offers Start free on the self-serve plans and Talk to us on Agency", () => {
    render(<PricingTable />);
    expect(screen.getAllByRole("button", { name: "Start free" })).toHaveLength(3);
    expect(screen.getByRole("button", { name: "Talk to us" })).toBeInTheDocument();
  });

  it("never states a trial duration", () => {
    const { container } = render(<PricingTable />);
    expect(container.textContent).not.toMatch(/\b\d+[- ]?(day|week|month)s?\b.*free/i);
    expect(container.textContent).not.toMatch(/trial/i);
  });

  it("gives the billing toggle an accessible group name", () => {
    render(<PricingTable />);
    expect(screen.getByRole("group", { name: "Billing period" })).toBeInTheDocument();
  });
});
