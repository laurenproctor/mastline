import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Badge, badgeTone } from "@/components/badge";
import { Badge as ReExported, type Tone } from "@/components/primitives";

describe("Badge", () => {
  it.each([
    ["neutral", "neutral"],
    ["good", "success"],
    ["warn", "warning"],
    ["danger", "danger"],
    ["blue", "info"],
  ] as const)("maps the legacy tone %s to data-tone %s", (legacy, semantic) => {
    render(<Badge tone={legacy}>Sent</Badge>);
    const badge = screen.getByText("Sent");
    expect(badge).toHaveClass("ml-badge");
    expect(badge).toHaveAttribute("data-tone", semantic);
    expect(badge.className).not.toContain(legacy === "neutral" ? "badge " : ` ${legacy}`);
  });

  it.each(["success", "warning", "danger", "info", "highlight", "neutral"] as const)(
    "accepts the semantic tone %s directly",
    (tone) => {
      render(<Badge tone={tone}>Paid</Badge>);
      expect(screen.getByText("Paid")).toHaveAttribute("data-tone", tone);
    },
  );

  it("is neutral by default", () => {
    render(<Badge>Draft</Badge>);
    expect(screen.getByText("Draft")).toHaveAttribute("data-tone", "neutral");
  });

  it("keeps its children visible, so the state is never colour alone", () => {
    render(
      <Badge tone="danger">
        <span>Overdue</span>
      </Badge>,
    );
    expect(screen.getByText("Overdue")).toBeVisible();
  });

  it("appends a caller's class", () => {
    render(
      <Badge className="row-badge" tone="good">
        Licensed
      </Badge>,
    );
    expect(screen.getByText("Licensed")).toHaveClass("ml-badge", "row-badge");
  });

  it("is the same component when imported from primitives", () => {
    expect(ReExported).toBe(Badge);
    const tone: Tone = "warn";
    expect(badgeTone(tone)).toBe("warning");
    expect(badgeTone(undefined)).toBe("neutral");
  });
});
