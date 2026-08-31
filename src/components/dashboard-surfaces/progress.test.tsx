import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Progress } from "./index";

describe("Progress", () => {
  it("is a determinate progressbar named by its visible label", () => {
    render(<Progress label="Captions written" value={61} />);
    const bar = screen.getByRole("progressbar", { name: "Captions written" });
    expect(bar).toHaveAttribute("aria-valuenow", "61");
    expect(bar).toHaveAttribute("aria-valuemin", "0");
    expect(bar).toHaveAttribute("aria-valuemax", "100");
    expect(bar).toHaveClass("ml-progress");
    expect(screen.getByText("Captions written")).toBeVisible();
    expect(screen.getByText("61%")).toHaveClass("ml-progress-block__value");
    expect(bar.querySelector(".ml-progress__bar")).toHaveStyle({ width: "61%" });
  });

  it("measures against a maximum and can say the value in its own words", () => {
    render(<Progress label="Frames ready" max={20} value={12} valueText="12 of 20" />);
    const bar = screen.getByRole("progressbar", { name: "Frames ready" });
    expect(bar).toHaveAttribute("aria-valuemax", "20");
    expect(bar).toHaveAttribute("aria-valuenow", "12");
    expect(bar).toHaveAttribute("aria-valuetext", "12 of 20");
    expect(screen.getByText("12 of 20")).toBeInTheDocument();
    expect(bar.querySelector(".ml-progress__bar")).toHaveStyle({ width: "60%" });
  });

  it.each([
    ["past the end", 140, 100, "100", "100%"],
    ["below zero", -20, 100, "0", "0%"],
    ["not a number", Number.NaN, 100, "0", "0%"],
  ])("clamps a value %s", (_case, value, max, expectedNow, expectedWidth) => {
    render(<Progress label="Over" max={max} value={value} />);
    const bar = screen.getByRole("progressbar", { name: "Over" });
    expect(bar).toHaveAttribute("aria-valuenow", expectedNow);
    expect(bar.querySelector(".ml-progress__bar")).toHaveStyle({ width: expectedWidth });
  });

  it("treats a zero or negative maximum as 100 rather than dividing by it", () => {
    render(<Progress label="Broken max" max={0} value={50} />);
    const bar = screen.getByRole("progressbar", { name: "Broken max" });
    expect(bar).toHaveAttribute("aria-valuemax", "100");
    expect(bar).toHaveAttribute("aria-valuenow", "50");
  });

  it("can hide the figure while keeping it in the accessible value", () => {
    const { container } = render(<Progress label="Quiet" showValue={false} value={30} />);
    expect(container.querySelector(".ml-progress-block__value")).toBeNull();
    expect(screen.getByRole("progressbar", { name: "Quiet" })).toHaveAttribute(
      "aria-valuenow",
      "30",
    );
  });

  it("carries a tone as data on the block", () => {
    const { container } = render(<Progress label="Storage" tone="warning" value={91} />);
    expect(container.firstElementChild).toHaveAttribute("data-tone", "warning");
  });
});
