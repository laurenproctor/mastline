import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { COMMERCIAL_OPPORTUNITIES } from "@/lib/commercial-opportunities";
import { OpportunityReview } from "./opportunity-review";

const opportunity = COMMERCIAL_OPPORTUNITIES.find(
  (candidate) => candidate.id === "julian-cross-soho",
)!;

describe("commercial opportunity review", () => {
  it("keeps pitch preparation behind product confirmation", async () => {
    const user = userEvent.setup();
    render(<OpportunityReview opportunity={opportunity} />);

    await user.click(screen.getByRole("button", { name: /prepare brand pitch/i }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByText(/confirm every product match/i)).toBeInTheDocument();
  });

  it("opens a reviewable pitch only after all matches are confirmed", async () => {
    const user = userEvent.setup();
    render(<OpportunityReview opportunity={opportunity} />);

    await user.click(screen.getByRole("button", { name: /confirm all matches/i }));
    await user.click(screen.getByRole("button", { name: /prepare brand pitch/i }));

    const dialog = screen.getByRole("dialog", { name: /brand licensing pitch/i });
    expect(within(dialog).getByText(/draft outreach · not sent/i)).toBeInTheDocument();
    expect(
      within(dialog).getByText(/paid advertising and endorsement language excluded/i),
    ).toBeInTheDocument();
  });

  it("supports the second route from the same confirmed record", async () => {
    const user = userEvent.setup();
    render(<OpportunityReview opportunity={opportunity} />);

    await user.click(screen.getByRole("button", { name: /confirm all matches/i }));
    await user.click(screen.getByRole("tab", { name: /shop the look/i }));
    await user.click(screen.getByRole("button", { name: /generate shop page draft/i }));

    expect(screen.getByRole("button", { name: /shop page draft created/i })).toBeInTheDocument();
    expect(screen.getByText(/do not imply endorsement/i)).toBeInTheDocument();
  });
});
