import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OnboardingFlow } from "./onboarding-flow";

vi.mock("./actions", () => ({
  createWorkspaceAction: vi.fn(async () => ({})),
}));

describe("OnboardingFlow", () => {
  beforeEach(() => {
    vi.stubGlobal("scrollTo", vi.fn());
  });

  it("carries a photographer through all seven stages", async () => {
    const user = userEvent.setup();
    render(
      <OnboardingFlow
        email="marcus@mastline.test"
        suggestedName="Marcus Hale Studio"
        trialLabel="30 days on Pro · 25 GB · no card"
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Your pictures should work as hard as you do." }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Set up my workspace" }));
    expect(screen.getByRole("heading", { name: "How do you work?" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(
      screen.getByRole("heading", { name: "What should Mastline handle first?" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByRole("heading", { name: "Start with one shoot." })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(
      screen.getByRole("heading", { name: "Here’s what Mastline found." }),
    ).toBeInTheDocument();

    const secondFrame = screen.getByRole("button", { name: "View sample frame 2" });
    await user.click(secondFrame);
    expect(secondFrame).toHaveAttribute("aria-pressed", "true");

    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByRole("heading", { name: "How can this work be used?" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Review setup" }));
    expect(
      screen.getByRole("heading", { name: "Your first shoot is ready to work." }),
    ).toBeInTheDocument();
    expect(screen.getByText("Marcus Hale Studio")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Create workspace and continue" }),
    ).toBeInTheDocument();
  });

  it("requires a workspace name before leaving the profile stage", async () => {
    const user = userEvent.setup();
    render(
      <OnboardingFlow
        email="marcus@mastline.test"
        suggestedName="Marcus Hale Studio"
        trialLabel="30 days on Pro · 25 GB · no card"
      />,
    );

    await user.click(screen.getByRole("button", { name: "Set up my workspace" }));
    await user.clear(screen.getByLabelText("Workspace name"));
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
  });
});
