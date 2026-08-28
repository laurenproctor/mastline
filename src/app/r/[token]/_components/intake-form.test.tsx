import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// The action reaches a server-only data module, which has no place in jsdom.
// The form's behaviour under test is its markup, not what the action does.
vi.mock("../actions", () => ({
  submitIntakeAction: vi.fn(async () => ({})),
}));

import { IntakeForm } from "./intake-form";

/*
 * The form a picture desk fills in, often on a phone at the side of a road.
 *
 * These assertions are about whether it can be operated at all -- by a screen
 * reader, by a keyboard, by a thumb -- rather than about how it looks. There is
 * no axe in this repository, so each rule is stated explicitly instead of
 * delegated to a scanner.
 */
describe("the intake form", () => {
  it("gives every control a label a screen reader can announce", () => {
    render(<IntakeForm token={"a".repeat(43)} />);

    // getByLabelText throws when a control has no accessible name, so this is
    // the assertion: every one of these resolves.
    for (const name of [
      /^Title/,
      /What you need/,
      /Subject or event/,
      /Event date and time/,
      /^Location/,
      /Your deadline/,
      /What you would like/,
      /Usage or media/,
      /^Territory/,
      /^Duration/,
      /^Exclusivity/,
      /Embargo until/,
      /^Restrictions/,
      /Your name/,
    ]) {
      expect(screen.getByLabelText(name)).toBeInTheDocument();
    }
  });

  it("groups the form so it can be navigated by section", () => {
    render(<IntakeForm token={"a".repeat(43)} />);
    const groups = screen.getAllByRole("group");
    const legends = groups.map((group) => group.querySelector("legend")?.textContent);
    expect(legends).toEqual(
      expect.arrayContaining([
        "The story",
        "When and where",
        "Deliverables",
        "Terms you are asking for",
        "Budget",
        "Who is sending this",
      ]),
    );
  });

  it("asks for a title and nothing else", () => {
    render(<IntakeForm token={"a".repeat(43)} />);
    expect(screen.getByLabelText(/^Title/)).toBeRequired();
    for (const name of [/What you need/, /^Territory/, /Your name/]) {
      expect(screen.getByLabelText(name)).not.toBeRequired();
    }
  });

  /*
   * The commercially load-bearing bit of the interface. A desk that says
   * nothing about money must not be recorded as having offered zero, and the
   * form has to say which of those it is doing.
   */
  it("states that an undisclosed budget is not provided rather than zero", () => {
    render(<IntakeForm token={"a".repeat(43)} />);
    const budget = screen
      .getAllByRole("group")
      .find((group) => group.querySelector("legend")?.textContent === "Budget");
    expect(within(budget!).getByText(/not provided/i)).toBeInTheDocument();
    expect(within(budget!).getByText(/different from zero/i)).toBeInTheDocument();
    // No figure inputs until somebody says they have one.
    expect(screen.queryByLabelText(/^From/)).not.toBeInTheDocument();
  });

  it("tells the visitor what leaving a term blank means", () => {
    render(<IntakeForm token={"a".repeat(43)} />);
    expect(
      screen.getByText(/Anything you leave blank is recorded as not provided/i),
    ).toBeInTheDocument();
  });

  it("says the typed name is a claim, not an identification", () => {
    render(<IntakeForm token={"a".repeat(43)} />);
    const note = screen.getByText(/your claim rather than as proof of who you are/i);
    expect(note).toBeInTheDocument();
  });

  it("promises a record and refuses to promise coverage", () => {
    render(<IntakeForm token={"a".repeat(43)} />);
    const note = screen.getByText(/creates a request in the photographer/i);
    expect(note.textContent).toMatch(/not an assignment/i);
    expect(note.textContent).toMatch(/covering it, accepting it, or delivering anything/i);
  });

  it("carries the token without putting anything about the buyer in the form", () => {
    const { container } = render(<IntakeForm token={"a".repeat(43)} />);
    const hidden = container.querySelectorAll('input[type="hidden"]');
    expect(hidden).toHaveLength(1);
    expect(hidden[0].getAttribute("name")).toBe("token");
  });

  it("caps each field at the length the database accepts", () => {
    render(<IntakeForm token={"a".repeat(43)} />);
    expect(screen.getByLabelText(/^Title/)).toHaveAttribute("maxLength", "200");
    expect(screen.getByLabelText(/What you need/)).toHaveAttribute("maxLength", "4000");
    expect(screen.getByLabelText(/^Territory/)).toHaveAttribute("maxLength", "500");
  });

  it("offers formats as checkboxes inside their own named group", () => {
    render(<IntakeForm token={"a".repeat(43)} />);
    const formats = screen
      .getAllByRole("group")
      .find((group) => group.querySelector("legend")?.textContent === "Formats");
    expect(formats).toBeDefined();
    const boxes = within(formats!).getAllByRole("checkbox");
    expect(boxes.map((box) => box.getAttribute("value"))).toEqual(["JPEG", "TIFF", "RAW", "Video"]);
  });
});
