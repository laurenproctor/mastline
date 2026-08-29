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
    const group = screen.getByRole("group", { name: "This period" });
    expect(group).toHaveClass("ml-metric-group");
    const lists = group.querySelectorAll("dl.ml-metric");
    expect(lists).toHaveLength(2);
    for (const list of lists) {
      expect(list.querySelectorAll(":scope > dt.ml-metric__label")).toHaveLength(1);
      expect(list.querySelectorAll(":scope > dd.ml-metric__body")).toHaveLength(1);
    }
    expect(Array.from(group.querySelectorAll("dt")).map((t) => t.textContent)).toEqual([
      "Received",
      "Median dispatch",
    ]);
  });

  it("is valid markup on its own, outside any group", () => {
    const { container } = render(<Metric label="Received" value="$2,788" />);
    const list = container.firstElementChild as HTMLElement;
    expect(list.tagName).toBe("DL");
    expect(list.querySelector("dt")).toHaveTextContent("Received");
    expect(list.querySelector("dd")).toHaveTextContent("$2,788");
    // No dt or dd is ever a direct child of anything but a dl.
    for (const cell of container.querySelectorAll("dt, dd")) {
      expect(cell.parentElement?.tagName).toBe("DL");
    }
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
