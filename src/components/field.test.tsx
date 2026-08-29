import { render, screen } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it } from "vitest";
import { Field } from "@/components/field";
import { Field as ReExported } from "@/components/primitives";

describe("Field", () => {
  it("binds the label to a native input by a derived id", () => {
    render(<Field label="Subject or event" name="title" />);
    const input = screen.getByLabelText("Subject or event");
    expect(input).toBeInstanceOf(HTMLInputElement);
    expect(input.id).toBe("field-title");
    expect(input).toHaveClass("ml-input");
    expect(input).toHaveAttribute("name", "title");
    expect(document.querySelector("label")).toHaveClass("ml-label");
    expect(document.querySelector(".ml-field")).not.toBeNull();
  });

  it("renders a textarea and a select on request, on their own classes", () => {
    render(
      <>
        <Field control="textarea" label="Story angle" name="storyAngle" />
        <Field control="select" label="Priority" name="priority">
          <option>High</option>
        </Field>
      </>,
    );
    expect(screen.getByLabelText("Story angle")).toBeInstanceOf(HTMLTextAreaElement);
    expect(screen.getByLabelText("Story angle")).toHaveClass("ml-textarea");
    expect(screen.getByLabelText("Priority")).toBeInstanceOf(HTMLSelectElement);
    expect(screen.getByLabelText("Priority")).toHaveClass("ml-select");
  });

  it("keeps two same-named fields apart with idSuffix", () => {
    render(
      <>
        <Field idSuffix="row-1" label="Recipient" name="recipient" />
        <Field idSuffix="row-2" label="Recipient" name="recipient" />
      </>,
    );
    const [first, second] = screen.getAllByLabelText("Recipient");
    expect(first.id).toBe("field-recipient-row-1");
    expect(second.id).toBe("field-recipient-row-2");
  });

  it("marks a required field in the label as well as on the control", () => {
    render(<Field label="Subject" name="title" required />);
    expect(screen.getByLabelText(/Subject/)).toBeRequired();
    const mark = document.querySelector(".required-mark");
    expect(mark).toHaveAttribute("aria-hidden", "true");
    expect(mark).toHaveTextContent("*");
  });

  it("describes the control by its hint", () => {
    render(<Field hint="Defaults to now." label="Date" name="startsAt" />);
    const input = screen.getByLabelText("Date");
    expect(input).toHaveAttribute("aria-describedby", "field-startsAt-hint");
    const hint = document.getElementById("field-startsAt-hint");
    expect(hint).toHaveClass("ml-help");
    expect(hint).toHaveTextContent("Defaults to now.");
    expect(input).not.toHaveAttribute("aria-invalid");
    expect(document.querySelector(".ml-field")).not.toHaveAttribute("data-invalid");
  });

  it("marks an error on the control, the wrapper, and announces it", () => {
    render(
      <Field
        error="Give the shoot a subject."
        hint="Keep it short."
        label="Subject"
        name="title"
      />,
    );
    const input = screen.getByLabelText("Subject");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input.getAttribute("aria-describedby")).toBe("field-title-error field-title-hint");
    const error = screen.getByRole("alert");
    expect(error).toHaveClass("ml-error");
    expect(error).toHaveTextContent("Give the shoot a subject.");
    expect(document.querySelector(".ml-field")).toHaveAttribute("data-invalid", "true");
  });

  it("omits aria-describedby when there is nothing to describe with", () => {
    render(<Field label="Embargo" name="embargo" />);
    expect(screen.getByLabelText("Embargo")).not.toHaveAttribute("aria-describedby");
  });

  it("passes native props and the ref through to the control", () => {
    const ref = createRef<HTMLInputElement>();
    render(
      <Field
        defaultValue="Hotel Chelsea"
        label="Subject"
        maxLength={80}
        name="title"
        placeholder="Where"
        ref={ref}
        type="text"
      />,
    );
    const input = screen.getByLabelText("Subject");
    expect(ref.current).toBe(input);
    expect(input).toHaveValue("Hotel Chelsea");
    expect(input).toHaveAttribute("maxlength", "80");
    expect(input).toHaveAttribute("placeholder", "Where");
  });

  it("spans the form grid with `full`, and takes a wrapper class", () => {
    render(<Field className="archive-query" full label="Search" name="q" />);
    expect(document.querySelector(".ml-field")).toHaveClass("ml-field--full", "archive-query");
    expect(screen.getByLabelText("Search")).not.toHaveClass("archive-query");
  });

  it("is the same component when imported from primitives", () => {
    expect(ReExported).toBe(Field);
  });
});
