import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Field, PendingButton, Progress } from "./primitives";

describe("Field", () => {
  it("associates the label with the control", () => {
    render(<Field label="Subject or event" name="title" />);
    const input = screen.getByLabelText("Subject or event");
    expect(input).toBeInstanceOf(HTMLInputElement);
    expect(input.id).toBe("field-title");
  });

  it("associates the label with a textarea", () => {
    render(<Field control="textarea" label="Story angle" name="storyAngle" />);
    expect(screen.getByLabelText("Story angle")).toBeInstanceOf(HTMLTextAreaElement);
  });

  it("associates the label with a select", () => {
    render(
      <Field control="select" label="Priority" name="priority">
        <option>High</option>
      </Field>,
    );
    expect(screen.getByLabelText("Priority")).toBeInstanceOf(HTMLSelectElement);
  });

  it("names the control so a form submission can read it", () => {
    render(<Field label="Location" name="locationName" />);
    expect(screen.getByLabelText("Location")).toHaveAttribute("name", "locationName");
  });

  it("links a hint to the control by aria-describedby", () => {
    render(
      <Field hint="Visible only to roles with source access." label="Source note" name="note" />,
    );
    const input = screen.getByLabelText("Source note");
    const describedBy = input.getAttribute("aria-describedby");
    expect(describedBy).toBe("field-note-hint");
    expect(document.getElementById(describedBy!)).toHaveTextContent(
      "Visible only to roles with source access.",
    );
  });

  it("omits aria-describedby when there is no hint", () => {
    render(<Field label="Embargo" name="embargo" />);
    expect(screen.getByLabelText("Embargo")).not.toHaveAttribute("aria-describedby");
  });

  it("marks the control invalid and announces the message when there is an error", () => {
    render(<Field error="Give the shoot a subject." label="Subject" name="title" />);
    const input = screen.getByLabelText("Subject");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("alert")).toHaveTextContent("Give the shoot a subject.");
    expect(input.getAttribute("aria-describedby")).toContain("field-title-error");
  });

  it("is not marked invalid when there is no error", () => {
    render(<Field label="Subject" name="title" />);
    expect(screen.getByLabelText("Subject")).not.toHaveAttribute("aria-invalid");
  });

  it("points at both the error and the hint when both are present", () => {
    render(<Field error="Too long." hint="Keep it short." label="Subject" name="title" />);
    const describedBy = screen.getByLabelText("Subject").getAttribute("aria-describedby") ?? "";
    expect(describedBy).toContain("field-title-error");
    expect(describedBy).toContain("field-title-hint");
  });
});

describe("PendingButton", () => {
  it("announces itself as unavailable rather than silently doing nothing", () => {
    render(<PendingButton>Approve and send</PendingButton>);
    const button = screen.getByRole("button", { name: "Approve and send" });
    expect(button).toHaveAttribute("aria-disabled", "true");
  });

  it("stays reachable by keyboard so the layout can be reviewed", () => {
    render(<PendingButton>Save draft</PendingButton>);
    const button = screen.getByRole("button", { name: "Save draft" });
    button.focus();
    expect(button).toHaveFocus();
  });

  it("never submits a form implicitly", () => {
    render(<PendingButton>Choose folder</PendingButton>);
    expect(screen.getByRole("button", { name: "Choose folder" })).toHaveAttribute("type", "button");
  });
});

describe("Progress", () => {
  it("exposes its value to assistive technology", () => {
    render(<Progress label="Captions" value={61} />);
    const bar = screen.getByRole("progressbar", { name: "Captions" });
    expect(bar).toHaveAttribute("aria-valuenow", "61");
    expect(bar).toHaveAttribute("aria-valuemin", "0");
    expect(bar).toHaveAttribute("aria-valuemax", "100");
  });

  it("states the percentage in text, not by bar width alone", () => {
    render(<Progress label="Captions" value={61} />);
    expect(screen.getByText("61%")).toBeInTheDocument();
  });

  it("clamps out-of-range values", () => {
    render(<Progress label="Over" value={140} />);
    expect(screen.getByRole("progressbar", { name: "Over" })).toHaveAttribute(
      "aria-valuenow",
      "100",
    );
  });

  it("clamps negative values", () => {
    render(<Progress label="Under" value={-20} />);
    expect(screen.getByRole("progressbar", { name: "Under" })).toHaveAttribute(
      "aria-valuenow",
      "0",
    );
  });
});
