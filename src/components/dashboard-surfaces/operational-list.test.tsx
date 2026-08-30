import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ActionLink } from "@/components/button";
import { Badge } from "@/components/badge";
import { OperationalList, OperationalListRow } from "./index";

describe("OperationalList", () => {
  it("is a named list of rows with the canonical and operational classes", () => {
    render(
      <OperationalList label="Needs attention">
        <OperationalListRow title="No outcome recorded for BG-0819-441" />
      </OperationalList>,
    );
    const list = screen.getByRole("list", { name: "Needs attention" });
    expect(list.tagName).toBe("UL");
    expect(list).toHaveClass("ml-list", "ml-operational-list");
    expect(list).not.toHaveClass("ml-operational-list--compact");
    expect(within(list).getAllByRole("listitem")).toHaveLength(1);
  });

  it("has a compact density", () => {
    render(
      <OperationalList compact>
        <OperationalListRow title="x" />
      </OperationalList>,
    );
    expect(screen.getByRole("list")).toHaveClass("ml-operational-list--compact");
  });
});

describe("OperationalListRow", () => {
  function renderRow(extra: Partial<Parameters<typeof OperationalListRow>[0]> = {}) {
    return render(
      <OperationalList>
        <OperationalListRow
          action={
            <ActionLink href="/studio/submissions/1" size="sm" variant="secondary">
              Record
            </ActionLink>
          }
          date="2 hr"
          href="/studio/submissions/1"
          meta="Awaiting a sale or no-sale · An unresolved submission is invisible revenue"
          status={<Badge tone="info">Submission</Badge>}
          title="No outcome recorded for B-0828-5528"
          {...extra}
        />
      </OperationalList>,
    );
  }

  it("lays out status, title and metadata, date, and action as named regions in reading order", () => {
    renderRow();
    const row = screen.getByRole("listitem");
    expect(row).toHaveClass("ml-list-row", "ml-operational-row");
    const regions = Array.from(row.children).map((child) => child.className.split(" ")[0]);
    expect(regions).toEqual([
      "ml-operational-row__status",
      "ml-operational-row__body",
      "ml-operational-row__date",
      "ml-operational-row__action",
    ]);
    expect(screen.getByText("Submission")).toHaveClass("ml-badge");
    expect(screen.getByText(/Awaiting a sale/)).toHaveClass("ml-list-row__meta");
    expect(screen.getByText("2 hr")).toHaveClass("ml-operational-row__date");
  });

  it("makes the title a link and the action a separate control, never one inside the other", () => {
    renderRow();
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(2);
    const [titleLink, actionLink] = links;
    expect(titleLink).toHaveTextContent("No outcome recorded for B-0828-5528");
    expect(titleLink).toHaveClass("ml-operational-row__title-link");
    expect(actionLink).toHaveTextContent("Record");
    expect(titleLink.contains(actionLink)).toBe(false);
    expect(actionLink.contains(titleLink)).toBe(false);
    // The row itself is not a control.
    expect(screen.getByRole("listitem")).not.toHaveAttribute("tabindex");
    expect(screen.getByRole("listitem")).not.toHaveAttribute("role", "button");
  });

  it("uses a heading at the configured level for the title", () => {
    renderRow({ level: 4 });
    expect(screen.getByRole("heading", { level: 4 })).toHaveTextContent(
      "No outcome recorded for B-0828-5528",
    );
  });

  it("says a high priority in words as well as with the rule", () => {
    renderRow({ priority: "high" });
    const row = screen.getByRole("listitem");
    expect(row).toHaveAttribute("data-priority", "high");
    const hidden = row.querySelector(".ml-visually-hidden");
    expect(hidden).toHaveTextContent("Urgent:");
    expect(screen.getByRole("heading")).toHaveTextContent(/^Urgent: No outcome recorded/);
  });

  it("renders only the regions it is given", () => {
    render(
      <OperationalList>
        <OperationalListRow title="Just a title" />
      </OperationalList>,
    );
    const row = screen.getByRole("listitem");
    expect(row).not.toHaveAttribute("data-priority");
    expect(row.querySelector(".ml-operational-row__status")).toBeNull();
    expect(row.querySelector(".ml-operational-row__date")).toBeNull();
    expect(row.querySelector(".ml-operational-row__action")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByRole("heading", { level: 3 })).toHaveTextContent("Just a title");
  });
});
