import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Metric, MetricGroup } from "./index";

describe("Metric", () => {
  it("is a term and its value inside a description list", () => {
    render(
      <MetricGroup label="This period">
        <Metric label="Received" value="$2,788" />
        <Metric label="Median dispatch" value="30 min" />
      </MetricGroup>,
    );
    const group = document.querySelector("dl.ml-metric-group") as HTMLElement;
    expect(group).toHaveAttribute("aria-label", "This period");
    expect(group).toHaveClass("ml-metric-group");
    const terms = group.querySelectorAll("dt.ml-metric__label");
    expect(Array.from(terms).map((t) => t.textContent)).toEqual(["Received", "Median dispatch"]);
    expect(group.querySelectorAll("dd.ml-metric__body")).toHaveLength(2);
  });

  it.each([
    ["currency", "$1,234,567.89"],
    ["a percentage", "61%"],
    ["a plain count", "1,540"],
    ["text", "—"],
  ])("draws %s exactly as given, without reformatting", (_kind, value) => {
    render(
      <MetricGroup>
        <Metric label="Value" value={value} />
      </MetricGroup>,
    );
    expect(screen.getByText(value)).toHaveClass("ml-metric__value");
  });

  it("says the trend and the state in words, with the direction as data", () => {
    render(
      <MetricGroup>
        <Metric
          detail="1 overdue"
          label="Outstanding"
          tone="danger"
          trend={{ direction: "up", label: "up 12% on last period" }}
          value="$1,200"
        />
      </MetricGroup>,
    );
    const trend = screen.getByText(/up 12% on last period/);
    expect(trend).toHaveClass("ml-metric__trend");
    expect(trend).toHaveAttribute("data-direction", "up");
    expect(trend.querySelector("[aria-hidden='true']")).toHaveTextContent("▲");
    expect(screen.getByText("1 overdue")).toHaveAttribute("data-tone", "danger");
  });

  it("omits detail and trend when they are not given", () => {
    const { container } = render(
      <MetricGroup>
        <Metric label="Unmatched" value="$0" />
      </MetricGroup>,
    );
    expect(container.querySelector(".ml-metric__detail")).toBeNull();
    expect(container.querySelector(".ml-metric__trend")).toBeNull();
  });
});
