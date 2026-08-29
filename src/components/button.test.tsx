import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  ActionLink,
  Button,
  IconButton,
  PendingButton,
  TextLink,
  buttonClasses,
} from "@/components/button";

describe("Button", () => {
  it("is a native button that does not submit by default", () => {
    render(<Button>Record</Button>);
    const button = screen.getByRole("button", { name: "Record" });
    expect(button.tagName).toBe("BUTTON");
    expect(button).toHaveAttribute("type", "button");
    expect(button).toHaveClass("ml-button");
  });

  it("keeps an explicit submit type for forms and server actions", () => {
    render(<Button type="submit">Switch</Button>);
    expect(screen.getByRole("button", { name: "Switch" })).toHaveAttribute("type", "submit");
  });

  it.each([
    ["primary", ["ml-button"], ["ml-button--secondary", "ml-button--quiet"]],
    ["secondary", ["ml-button", "ml-button--secondary"], []],
    ["quiet", ["ml-button", "ml-button--quiet"], []],
    ["highlight", ["ml-button", "ml-button--highlight"], []],
    ["danger", ["ml-button", "ml-button--danger"], []],
  ] as const)("draws the %s variant", (variant, present, absent) => {
    render(<Button variant={variant}>Go</Button>);
    const button = screen.getByRole("button");
    expect(button).toHaveClass(...present);
    for (const cls of absent) expect(button).not.toHaveClass(cls);
  });

  it.each([
    ["sm", "ml-button--sm"],
    ["lg", "ml-button--lg"],
  ] as const)("draws the %s size", (size, cls) => {
    render(<Button size={size}>Go</Button>);
    expect(screen.getByRole("button")).toHaveClass("ml-button", cls);
  });

  it("has no size modifier at the default size", () => {
    render(<Button>Go</Button>);
    expect(screen.getByRole("button").className).toBe("ml-button");
  });

  it("appends a caller's class without dropping the canonical ones", () => {
    render(
      <Button className="allocate-submit" size="sm" variant="secondary">
        Go
      </Button>,
    );
    expect(screen.getByRole("button")).toHaveClass(
      "ml-button",
      "ml-button--secondary",
      "ml-button--sm",
      "allocate-submit",
    );
  });

  it("does not fire when disabled", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Go
      </Button>,
    );
    const button = screen.getByRole("button");
    expect(button).toBeDisabled();
    await user.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("forwards native attributes and the ref", () => {
    const ref = createRef<HTMLButtonElement>();
    render(
      <Button aria-describedby="why" form="allocate" name="intent" ref={ref} value="save">
        Go
      </Button>,
    );
    const button = screen.getByRole("button");
    expect(button).toHaveAttribute("aria-describedby", "why");
    expect(button).toHaveAttribute("form", "allocate");
    expect(button).toHaveAttribute("name", "intent");
    expect(button).toHaveAttribute("value", "save");
    expect(ref.current).toBe(button);
  });
});

describe("buttonClasses", () => {
  it("is deterministic for the same inputs", () => {
    expect(buttonClasses("danger", "lg", "x")).toBe("ml-button ml-button--danger ml-button--lg x");
    expect(buttonClasses()).toBe("ml-button");
  });
});

describe("ActionLink", () => {
  it("is a link, not a button, and keeps its destination", () => {
    render(<ActionLink href="/studio/shoots/new?from=work">Create shoot</ActionLink>);
    const link = screen.getByRole("link", { name: "Create shoot" });
    expect(link.tagName).toBe("A");
    expect(link).toHaveAttribute("href", "/studio/shoots/new?from=work");
    expect(link).toHaveClass("ml-button");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("takes the same variants and sizes as a button", () => {
    render(
      <ActionLink className="card-open" href="/studio/shoots/1" size="sm" variant="secondary">
        Open shoot
      </ActionLink>,
    );
    expect(screen.getByRole("link")).toHaveClass(
      "ml-button",
      "ml-button--secondary",
      "ml-button--sm",
      "card-open",
    );
  });

  it("never carries a disabled state", () => {
    render(<ActionLink href="/studio/archive">Archive</ActionLink>);
    const link = screen.getByRole("link");
    expect(link).not.toHaveAttribute("aria-disabled");
    expect(link).not.toHaveAttribute("disabled");
  });
});

describe("TextLink", () => {
  it("is an inline link with the text-link treatment", () => {
    render(
      <TextLink className="foot" href="/studio/money">
        View money
      </TextLink>,
    );
    const link = screen.getByRole("link", { name: "View money" });
    expect(link).toHaveAttribute("href", "/studio/money");
    expect(link).toHaveClass("ml-text-link", "foot");
  });
});

describe("IconButton", () => {
  it("is named by its label, not its icon", () => {
    render(
      <IconButton label="Close">
        <svg aria-hidden="true" />
      </IconButton>,
    );
    const button = screen.getByRole("button", { name: "Close" });
    expect(button).toHaveClass("ml-icon-button");
    expect(button).toHaveAttribute("type", "button");
  });
});

describe("PendingButton", () => {
  it("announces itself as unavailable and stays in the tab order", () => {
    render(<PendingButton>Export workspace</PendingButton>);
    const button = screen.getByRole("button", { name: "Export workspace" });
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).toHaveAttribute("type", "button");
    expect(button).toHaveClass("ml-button", "ml-button--secondary");
    button.focus();
    expect(button).toHaveFocus();
  });

  it("can take the primary treatment where a header asks for it", () => {
    render(
      <PendingButton small variant="primary">
        Send
      </PendingButton>,
    );
    const button = screen.getByRole("button");
    expect(button).toHaveClass("ml-button", "ml-button--sm");
    expect(button).not.toHaveClass("ml-button--secondary");
  });
});
