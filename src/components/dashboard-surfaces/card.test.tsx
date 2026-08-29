import { render, screen } from "@testing-library/react";
import Link from "next/link";
import { describe, expect, it } from "vitest";
import { Button, TextLink } from "@/components/button";

const MinifiedButton = Button;
import { Card, CardLink, PriorityCard, SURFACE_TONES, StatCard } from "./index";

describe("Card", () => {
  it("is a plain surface with an optional element and density", () => {
    const { container, rerender } = render(<Card>Body</Card>);
    expect(container.firstElementChild?.tagName).toBe("DIV");
    expect(container.firstElementChild).toHaveClass("ml-card");
    rerender(
      <Card as="article" compact>
        Body
      </Card>,
    );
    expect(container.firstElementChild?.tagName).toBe("ARTICLE");
    expect(container.firstElementChild).toHaveClass("ml-card", "ml-card--compact");
  });
});

describe("CardLink", () => {
  it("is one link with one destination and one accessible name", () => {
    render(
      <CardLink href="/studio/shoots/1" label="Open Hotel Chelsea departure">
        <strong>Hotel Chelsea departure</strong>
        <span>2 frames</span>
      </CardLink>,
    );
    const link = screen.getByRole("link", { name: "Open Hotel Chelsea departure" });
    expect(link.tagName).toBe("A");
    expect(link).toHaveAttribute("href", "/studio/shoots/1");
    expect(link).toHaveClass("ml-card", "ml-card--interactive", "ml-card-link");
    expect(screen.getAllByRole("link")).toHaveLength(1);
  });

  it("is named by its content when no label is given", () => {
    render(
      <CardLink href="/studio/money">
        <span>Revenue</span>
      </CardLink>,
    );
    expect(screen.getByRole("link", { name: "Revenue" })).toBeInTheDocument();
  });

  it.each([
    ["a native button", () => <button type="button">Open</button>],
    ["a native anchor", () => <a href="https://example.test/x">Open</a>],
    ["a Next Link", () => <Link href="/x">Open</Link>],
    ["a design-system Button", () => <Button>Open</Button>],
    ["a design-system TextLink", () => <TextLink href="/x">Open</TextLink>],
    // The same Button under a different name: the check is by reference, so
    // a minified production build cannot defeat it.
    ["a renamed Button", () => <MinifiedButton>Open</MinifiedButton>],
    [
      "a control nested deeper",
      () => (
        <div>
          <span>
            <button type="button">Deep</button>
          </span>
        </div>
      ),
    ],
  ])("refuses to wrap %s", (_label, child) => {
    expect(() =>
      render(
        <CardLink href="/studio/shoots/1">
          <span>Title</span>
          {child()}
        </CardLink>,
      ),
    ).toThrow(/CardLink is itself the interactive target/);
  });
});

describe("PriorityCard", () => {
  it.each(SURFACE_TONES)("carries the %s tone as data, not as a colour prop", (tone) => {
    const { container } = render(<PriorityCard title="Overdue: MEGA-5610" tone={tone} />);
    expect(container.firstElementChild).toHaveAttribute("data-tone", tone);
    expect(container.firstElementChild).toHaveClass("ml-priority-card");
  });

  it("is neutral by default and an article with a level-3 heading", () => {
    const { container } = render(<PriorityCard title="Finish metadata" />);
    expect(container.firstElementChild?.tagName).toBe("ARTICLE");
    expect(container.firstElementChild).toHaveAttribute("data-tone", "neutral");
    expect(screen.getByRole("heading", { level: 3, name: "Finish metadata" })).toBeInTheDocument();
  });

  it("takes a configured heading level and keeps the action beside the copy", () => {
    render(
      <PriorityCard
        action={<button type="button">Chase</button>}
        description="Payment is past its due date."
        level={2}
        meta="Urgent · 1200 outstanding"
        title="Overdue: MEGA-5610"
        tone="danger"
      />,
    );
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("Overdue: MEGA-5610");
    expect(screen.getByText("Payment is past its due date.")).toHaveClass(
      "ml-priority-card__description",
    );
    expect(screen.getByText("Urgent · 1200 outstanding")).toHaveClass("ml-priority-card__meta");
    const action = screen.getByRole("button", { name: "Chase" });
    expect(action.parentElement).toHaveClass("ml-priority-card__action");
    expect(action.closest("h2")).toBeNull();
  });

  it("keeps the grid shape with a placeholder when there is nothing leading", () => {
    const { container } = render(<PriorityCard title="x" />);
    const leading = container.querySelector(".ml-priority-card__leading");
    expect(leading).toHaveClass("ml-priority-card__leading--empty");
    expect(leading).toHaveAttribute("aria-hidden", "true");
  });
});

describe("StatCard", () => {
  it("shows label, a preformatted value, and a delta that says its direction in words", () => {
    render(
      <StatCard
        delta={{ direction: "down", label: "down 4% on last month" }}
        detail="1 overdue"
        label="Outstanding"
        tone="danger"
        value="$1,200"
      />,
    );
    expect(screen.getByText("Outstanding")).toHaveClass("ml-stat-card__label");
    expect(screen.getByText("$1,200")).toHaveClass("ml-stat-card__value");
    const delta = screen.getByText(/down 4% on last month/);
    expect(delta).toHaveAttribute("data-direction", "down");
    expect(delta.querySelector("[aria-hidden]")).toHaveTextContent("▼");
    expect(screen.getByText("1 overdue")).toHaveAttribute("data-tone", "danger");
  });

  it("renders no foot when there is neither detail nor delta", () => {
    const { container } = render(<StatCard label="Median dispatch" value="30 min" />);
    expect(container.querySelector(".ml-stat-card__foot")).toBeNull();
  });
});
