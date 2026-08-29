import { render, screen, within } from "@testing-library/react";
import Link from "next/link";
import { describe, expect, it } from "vitest";
import {
  DataTable,
  TableBody,
  TableCell,
  TableEmptyRow,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "./index";

function renderPayments(rows: Array<[string, string, string]>) {
  return render(
    <DataTable caption="Payments this period">
      <TableHead>
        <TableRow>
          <TableHeaderCell>Buyer</TableHeaderCell>
          <TableHeaderCell kind="status">Status</TableHeaderCell>
          <TableHeaderCell kind="numeric">Amount</TableHeaderCell>
          <TableHeaderCell kind="action">
            <span className="ml-visually-hidden">Actions</span>
          </TableHeaderCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {rows.length === 0 ? (
          <TableEmptyRow columns={4}>No payments have been recorded this period.</TableEmptyRow>
        ) : (
          rows.map(([buyer, status, amount]) => (
            <TableRow key={buyer}>
              <TableCell>{buyer}</TableCell>
              <TableCell kind="status">{status}</TableCell>
              <TableCell kind="numeric">{amount}</TableCell>
              <TableCell kind="action">
                <Link href="/studio/money/1">Allocate</Link>
              </TableCell>
            </TableRow>
          ))
        )}
      </TableBody>
    </DataTable>,
  );
}

describe("DataTable", () => {
  it("is a real table with a caption and column headers, inside a named, focusable scroll region", () => {
    renderPayments([["The Mega Agency", "Received", "$2,788"]]);
    const region = screen.getByRole("region", { name: "Payments this period" });
    expect(region).toHaveClass("ml-table-wrap", "ml-data-table");
    expect(region).toHaveAttribute("tabindex", "0");
    const table = within(region).getByRole("table", { name: "Payments this period" });
    expect(table).toHaveClass("ml-table");
    expect(table.querySelector("caption")).toHaveClass("ml-data-table__caption");
    const headers = within(table).getAllByRole("columnheader");
    expect(headers.map((h) => h.getAttribute("scope"))).toEqual(["col", "col", "col", "col"]);
    expect(within(table).getByRole("cell", { name: "The Mega Agency" })).toBeInTheDocument();
    expect(table.querySelector("thead")).not.toBeNull();
    expect(table.querySelector("tbody")).not.toBeNull();
  });

  it("never claims a grid role or replaces table elements", () => {
    renderPayments([["A", "Sent", "$1"]]);
    expect(screen.queryByRole("grid")).toBeNull();
    expect(document.querySelector('[role="row"], [role="gridcell"]')).toBeNull();
    expect(document.querySelectorAll("tr")).toHaveLength(2);
    expect(document.querySelectorAll("td")).toHaveLength(4);
  });

  it("marks numeric, status, and action cells for alignment", () => {
    renderPayments([["A", "Sent", "$1"]]);
    const cells = screen.getAllByRole("cell");
    expect(cells[1]).toHaveClass("ml-data-table__cell--status");
    expect(cells[2]).toHaveClass("is-numeric", "ml-data-table__cell--numeric");
    expect(cells[3]).toHaveClass("ml-data-table__cell--action");
    expect(screen.getAllByRole("columnheader")[2]).toHaveClass("is-numeric");
  });

  it("renders an empty row spanning every column, keeping caption and headers", () => {
    renderPayments([]);
    expect(screen.getByRole("table", { name: "Payments this period" })).toBeInTheDocument();
    expect(screen.getAllByRole("columnheader")).toHaveLength(4);
    const empty = screen.getByRole("cell", { name: /No payments have been recorded/ });
    expect(empty).toHaveAttribute("colspan", "4");
    expect(empty).toHaveClass("ml-data-table__empty-cell");
  });

  it("can hide the caption visually while keeping it for readers, and take an explicit region label", () => {
    render(
      <DataTable caption={<span>Matches</span>} captionHidden compact label="Rights matches">
        <TableBody>
          <TableRow>
            <TableCell>x</TableCell>
          </TableRow>
        </TableBody>
      </DataTable>,
    );
    const region = screen.getByRole("region", { name: "Rights matches" });
    expect(region).toHaveClass("ml-data-table--compact");
    expect(region.querySelector("caption")).toHaveClass("ml-visually-hidden");
    expect(screen.getByRole("table", { name: "Matches" })).toBeInTheDocument();
  });
});
