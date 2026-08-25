import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { Plans } from "./plans";

/**
 * These tests followed the plan grid from the old marketing page onto the new
 * one. The design changed; the facts they pin did not, and the artifact the new
 * design came from got three of them wrong.
 */
function renderPlans() {
  return render(
    <Plans eyebrow="Choose your operating level" heading="Built for the way you work now." />,
  );
}

/** The plan card whose heading matches `name`. */
function cardFor(name: string): HTMLElement {
  const heading = screen.getByRole("heading", { name, level: 3 });
  const card = heading.closest(".plan");
  if (!(card instanceof HTMLElement)) throw new Error(`No plan card found for "${name}"`);
  return card;
}

describe("billing toggle", () => {
  it("defaults to annual", () => {
    renderPlans();
    expect(screen.getByRole("button", { name: /annual/i })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /^monthly$/i })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("shows the annual prices by default", () => {
    renderPlans();
    expect(within(cardFor("Solo")).getByText("49")).toBeInTheDocument();
    expect(within(cardFor("Pro")).getByText("99")).toBeInTheDocument();
    expect(within(cardFor("Studio")).getByText("279")).toBeInTheDocument();
  });

  it("switches every non-custom plan to monthly", async () => {
    const user = userEvent.setup();
    renderPlans();
    await user.click(screen.getByRole("button", { name: /^monthly$/i }));

    expect(within(cardFor("Solo")).getByText("59")).toBeInTheDocument();
    expect(within(cardFor("Pro")).getByText("119")).toBeInTheDocument();
    expect(within(cardFor("Studio")).getByText("339")).toBeInTheDocument();
    expect(within(cardFor("Agency")).getByText("Custom")).toBeInTheDocument();
  });

  it("does not change any plan's features when the period changes", async () => {
    const user = userEvent.setup();
    renderPlans();
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
    renderPlans();
    expect(screen.getByText(/\$588 billed once a year/)).toBeInTheDocument();
    expect(screen.getByText(/\$1,188 billed once a year/)).toBeInTheDocument();
    expect(screen.getByText(/\$3,348 billed once a year/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^monthly$/i }));
    expect(screen.queryByText(/billed once a year/)).not.toBeInTheDocument();
  });

  it("is operable by keyboard", async () => {
    const user = userEvent.setup();
    renderPlans();
    const monthly = screen.getByRole("button", { name: /^monthly$/i });
    monthly.focus();
    await user.keyboard("{Enter}");
    expect(monthly).toHaveAttribute("aria-pressed", "true");
  });
});

describe("approved pricing presentation", () => {
  it("claims no more than 18% saving", () => {
    renderPlans();
    expect(screen.getByText("Save up to 18%")).toBeInTheDocument();
  });

  it("marks Pro as the only most-popular plan", () => {
    renderPlans();
    expect(screen.getAllByText("Most popular")).toHaveLength(1);
    expect(within(cardFor("Pro")).getByText("Most popular")).toBeInTheDocument();
  });

  it("offers Start free on the self-serve plans and Talk to us on Agency", () => {
    renderPlans();
    expect(screen.getAllByRole("link", { name: "Start free" })).toHaveLength(3);
    expect(screen.getByRole("link", { name: "Contact Mastline" })).toBeInTheDocument();
  });

  it("states the approved trial terms on every self-serve plan", () => {
    renderPlans();
    for (const name of ["Solo", "Pro", "Studio"]) {
      expect(
        within(cardFor(name)).getByText("30 days free. No card required."),
      ).toBeInTheDocument();
    }
  });

  it("sells the seat count the plan actually includes", () => {
    // The design artifact this page was ported from said ten. Studio is five,
    // and PLAN_SEATS is what the application enforces.
    renderPlans();
    expect(within(cardFor("Studio")).getByText(/Up to 5 team members/)).toBeInTheDocument();
    expect(within(cardFor("Studio")).queryByText(/Up to 10 team members/)).not.toBeInTheDocument();
  });

  it("does not offer a trial on the custom-priced Agency plan", () => {
    renderPlans();
    expect(within(cardFor("Agency")).queryByText(/days free/i)).not.toBeInTheDocument();
  });

  it("states no trial duration other than the approved 30 days", () => {
    const { container } = renderPlans();
    const claims = container.textContent?.match(/\d+[- ]?(day|week|month)s?\s+free/gi) ?? [];
    expect(new Set(claims)).toEqual(new Set(["30 days free"]));
  });

  it("makes no on-page claim about what happens when the trial ends", () => {
    const { container } = renderPlans();
    expect(container.textContent).not.toMatch(/auto[- ]?renew|cancel any ?time|after your trial/i);
  });

  it("gives the billing toggle an accessible group name", () => {
    renderPlans();
    expect(screen.getByRole("group", { name: "Billing period" })).toBeInTheDocument();
  });
});
