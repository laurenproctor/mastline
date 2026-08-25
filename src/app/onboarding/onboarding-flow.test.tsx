import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SALES_ENGINE_TERMS_VERSION } from "@/lib/onboarding";
import { OnboardingFlow } from "./onboarding-flow";

vi.mock("./actions", () => ({
  createWorkspaceAction: vi.fn(async () => ({})),
}));

describe("OnboardingFlow", () => {
  beforeEach(() => {
    vi.stubGlobal("scrollTo", vi.fn());
  });

  function renderFlow() {
    return render(
      <OnboardingFlow
        email="marcus@mastline.test"
        suggestedName="Marcus Hale Studio"
        trialLabel="30 days on Pro · 25 GB · no card"
      />,
    );
  }

  /** Step 0 through to the rights stage. */
  async function walkToRights(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole("button", { name: "Set up my workspace" }));
    for (let i = 0; i < 4; i += 1) {
      await user.click(screen.getByRole("button", { name: "Continue" }));
    }
  }

  /** All the way to the final stage, optionally opting into the Sales Engine. */
  async function walkToReady(
    user: ReturnType<typeof userEvent.setup>,
    options: { salesEngine?: boolean } = {},
  ) {
    await walkToRights(user);
    if (options.salesEngine) {
      await user.click(screen.getByRole("checkbox", { name: /Sales Engine|surface licensing/ }));
    }
    await user.click(screen.getByRole("button", { name: "Review setup" }));
  }

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

  it("says why a required answer blocks the step, not just that it does", async () => {
    const user = userEvent.setup();
    renderFlow();

    await user.click(screen.getByRole("button", { name: "Set up my workspace" }));
    await user.clear(screen.getByLabelText("Workspace name"));

    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
    expect(screen.getByText("Give the workspace a name.")).toBeInTheDocument();
  });

  it("will not leave the profile stage with no kind of work chosen", async () => {
    const user = userEvent.setup();
    renderFlow();

    await user.click(screen.getByRole("button", { name: "Set up my workspace" }));
    // Both defaults off again.
    await user.click(screen.getByRole("button", { name: "Celebrity" }));
    await user.click(screen.getByRole("button", { name: "Street style" }));

    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
    expect(screen.getByText("Choose at least one kind of work.")).toBeInTheDocument();
  });

  it("will not leave the priorities stage with nothing chosen", async () => {
    const user = userEvent.setup();
    renderFlow();

    await user.click(screen.getByRole("button", { name: "Set up my workspace" }));
    await user.click(screen.getByRole("button", { name: "Continue" }));

    for (const label of [
      "Organize shoots and assets",
      "Prepare and track submissions",
      "Find editorial opportunities",
    ]) {
      await user.click(screen.getByRole("button", { name: new RegExp(label) }));
    }

    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
    expect(screen.getByText("Choose at least one priority.")).toBeInTheDocument();
  });

  it("submits every profile answer, not just the name and timezone", async () => {
    const user = userEvent.setup();
    const { container } = renderFlow();
    await walkToReady(user);

    const named = (name: string) =>
      container.querySelector<HTMLInputElement>(`input[name="${name}"]`)?.value;

    expect(named("name")).toBe("Marcus Hale Studio");
    expect(named("timezone")).toBeTruthy();
    expect(named("workStyle")).toBe("independent");
    expect(named("baseCity")).toBe("New York, NY");
    expect(named("specialties")).toBe("celebrity, street_style");
    expect(named("goals")).toBe("organize, dispatch, editorial");
  });

  it("leaves the Sales Engine off unless it is turned on", async () => {
    const user = userEvent.setup();
    const { container } = renderFlow();
    await walkToReady(user);

    expect(container.querySelector('input[name="salesEngine"]')).toBeNull();
  });

  it("sends the Sales Engine opt-in when the photographer turns it on", async () => {
    const user = userEvent.setup();
    const { container } = renderFlow();
    await walkToReady(user, { salesEngine: true });

    expect(container.querySelector<HTMLInputElement>('input[name="salesEngine"]')?.value).toBe(
      "on",
    );
  });

  it("names the terms version beside the Sales Engine consent", async () => {
    const user = userEvent.setup();
    renderFlow();
    await walkToRights(user);

    expect(screen.getByText(new RegExp(SALES_ENGINE_TERMS_VERSION))).toBeInTheDocument();
  });

  it("labels the sample set as a demonstration rather than a record", async () => {
    const user = userEvent.setup();
    renderFlow();

    await user.click(screen.getByRole("button", { name: "Set up my workspace" }));
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.click(screen.getByRole("button", { name: "Continue" }));

    expect(screen.getByRole("note")).toHaveTextContent(/Nothing here is saved/);
  });

  it("offers no file input, because nothing here can import a file", async () => {
    const user = userEvent.setup();
    const { container } = renderFlow();

    await user.click(screen.getByRole("button", { name: "Set up my workspace" }));
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.click(screen.getByRole("button", { name: "Continue" }));

    expect(container.querySelector('input[type="file"]')).toBeNull();
  });
});
