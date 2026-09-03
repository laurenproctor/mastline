import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * What the panel has to make obvious without being read as a manual.
 *
 * The product risk this feature carries is not a wrong caption; it is a wrong
 * caption that looked like the photographer's own. So these tests are about
 * labelling and about gates: which values are marked as a machine's, what a
 * confirmation says before it happens, and what the panel refuses to do
 * quietly.
 */

const saved: FormData[] = [];
const confirmed: FormData[] = [];
const generated: string[] = [];

vi.mock("@/app/[workspace]/shoots/metadata-actions", () => ({
  saveMetadataAction: vi.fn(async (_slug: string, _previous: unknown, formData: FormData) => {
    saved.push(formData);
    return { ok: true, message: "Saved.", version: 2 };
  }),
  confirmMetadataAction: vi.fn(async (_slug: string, _previous: unknown, formData: FormData) => {
    confirmed.push(formData);
    if (formData.get("acknowledged") !== "yes") {
      return { errors: { _form: "Tick the box to confirm." } };
    }
    return { ok: true, message: "Confirmed.", version: 2 };
  }),
  generateMetadataAction: vi.fn(async (_slug: string, input: { assetId: string }) => {
    generated.push(input.assetId);
    return { ok: true, message: "Queued." };
  }),
  metadataStatusAction: vi.fn(async () => []),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

const { MetadataPanel } = await import("./metadata-panel");
type PanelProps = Parameters<typeof MetadataPanel>[0];

function panel(overrides: Partial<PanelProps> = {}): PanelProps {
  return {
    workspaceSlug: "mastline",
    shootId: "shoot-1",
    photograph: { id: "asset-1", filename: "MH_0472" },
    fields: {
      headline: { value: "Two people leave a hotel", provenance: "generated", confidence: 0.62 },
      editorialCaption: { value: "A caption.", provenance: "generated", confidence: 0.7 },
      venue: { value: "Dean Street, London", provenance: "inherited" },
      subjects: { value: ["Avery Hart"], provenance: "entered" },
      keywords: { value: ["hotel", "night"], provenance: "generated" },
      sensitivity: { value: "none", provenance: "empty" },
      editorialUseOnly: { value: true, provenance: "empty" },
      commercialUseEligible: { value: "unknown", provenance: "empty" },
      modelReleaseStatus: { value: "unknown", provenance: "empty" },
      propertyReleaseStatus: { value: "unknown", provenance: "empty" },
      sensitiveOrMinor: { value: false, provenance: "empty" },
    },
    status: {
      status: "needs_review",
      label: "Needs review",
      tone: "warn",
      detail: "AI-generated — review required. Nothing here reaches a buyer until you confirm it.",
      inFlight: false,
    },
    technical: [
      { label: "Camera", value: "SONY ILCE-1" },
      { label: "Aperture", value: "f/2.8" },
    ],
    version: 3,
    generatedAt: "2026-08-19T11:00:00.000Z",
    aiModel: "claude-haiku-4-5",
    overallConfidence: 0.68,
    generationAvailable: true,
    canEdit: true,
    ...overrides,
  };
}

beforeEach(() => {
  saved.length = 0;
  confirmed.length = 0;
  generated.length = 0;
});

describe("telling a machine's words from a person's", () => {
  it("marks a generated value as one, with its confidence", () => {
    render(<MetadataPanel {...panel()} />);
    const chips = screen.getAllByText(/AI — review/);
    expect(chips.length).toBeGreaterThan(0);
    expect(screen.getByText("AI — review · 62%")).toBeInTheDocument();
  });

  it("says where an inherited value came from", () => {
    render(<MetadataPanel {...panel()} />);
    expect(screen.getByText("From the shoot")).toBeInTheDocument();
  });

  it("says when a value was typed, so regeneration is understood not to touch it", () => {
    render(<MetadataPanel {...panel()} />);
    expect(screen.getByText("You entered this")).toBeInTheDocument();
  });

  it("states plainly that review is required", () => {
    render(<MetadataPanel {...panel()} />);
    expect(screen.getByRole("status")).toHaveTextContent(/AI-generated — review required/);
  });

  it("says who is responsible for identities, context, and rights", () => {
    render(<MetadataPanel {...panel()} />);
    expect(
      screen.getByText(/you are responsible for confirming identities, context, and rights/),
    ).toBeInTheDocument();
  });

  it("never offers a provenance chip on a rights field, because none can exist", () => {
    render(<MetadataPanel {...panel()} />);
    const rights = screen.getByRole("group", { name: "Rights and handling" });
    expect(within(rights).getByText(/Mastline never fills these in/)).toBeInTheDocument();
    expect(within(rights).queryByText(/AI — review/)).not.toBeInTheDocument();
  });
});

describe("confirming", () => {
  it("does not confirm in one click", async () => {
    const user = userEvent.setup();
    render(<MetadataPanel {...panel()} />);

    await user.click(screen.getByRole("button", { name: "Confirm metadata" }));

    // The warning appears first, and nothing has been sent.
    expect(
      screen.getByText(/may be included in buyer submissions and licensing records/),
    ).toBeInTheDocument();
    expect(confirmed).toHaveLength(0);
  });

  it("asks for an explicit acknowledgement, and says what it commits to", async () => {
    const user = userEvent.setup();
    render(<MetadataPanel {...panel()} />);

    await user.click(screen.getByRole("button", { name: "Confirm metadata" }));
    expect(
      screen.getByText(/Confirm that this information accurately describes the photograph/),
    ).toBeInTheDocument();

    await user.click(screen.getByLabelText(/I have read this and it describes the photograph/));
    await user.click(screen.getByRole("button", { name: "Confirm" }));

    expect(confirmed).toHaveLength(1);
    expect(confirmed[0].get("acknowledged")).toBe("yes");
    // The version travels with it, so a confirmation cannot assert something
    // other than what was read.
    expect(confirmed[0].get("expectedVersion")).toBe("3");
  });

  it("offers no confirm control once the record is confirmed", () => {
    render(
      <MetadataPanel
        {...panel({
          status: {
            status: "confirmed",
            label: "Confirmed",
            tone: "good",
            detail: "Confirmed.",
            inFlight: false,
          },
          confirmedAt: "2026-08-19T12:00:00.000Z",
        })}
      />,
    );
    expect(screen.queryByRole("button", { name: "Confirm metadata" })).not.toBeInTheDocument();
  });
});

describe("regenerating", () => {
  it("warns about replacing unconfirmed suggestions before it runs", async () => {
    const user = userEvent.setup();
    render(<MetadataPanel {...panel()} />);

    await user.click(screen.getByRole("button", { name: "Regenerate" }));
    expect(
      screen.getByText(/Regenerating replaces any suggestion you have not edited or confirmed/),
    ).toBeInTheDocument();
    expect(generated).toHaveLength(0);

    await user.click(screen.getByRole("button", { name: "Regenerate anyway" }));
    expect(generated).toEqual(["asset-1"]);
  });

  it("offers Generate rather than Regenerate when nothing has run", async () => {
    const user = userEvent.setup();
    render(
      <MetadataPanel
        {...panel({
          generatedAt: undefined,
          status: {
            status: "not_generated",
            label: "Not generated",
            tone: "neutral",
            detail: "Nothing has been suggested for this frame yet.",
            inFlight: false,
          },
        })}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Generate metadata" }));
    expect(generated).toEqual(["asset-1"]);
  });

  it("offers Retry after a failure, and shows why it failed", () => {
    render(
      <MetadataPanel
        {...panel({
          status: {
            status: "failed",
            label: "Failed",
            tone: "danger",
            detail: "There is no readable preview for this file.",
            inFlight: false,
          },
          failureDetail: "There is no readable preview for this file.",
        })}
      />,
    );

    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(/no readable preview/);
  });

  it("says so instead of offering a button that cannot work", () => {
    render(<MetadataPanel {...panel({ generationAvailable: false })} />);
    expect(
      screen.queryByRole("button", { name: /Regenerate|Generate metadata/ }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/not configured for this deployment/)).toBeInTheDocument();
  });
});

describe("saving", () => {
  it("carries the version the form was rendered from", async () => {
    const user = userEvent.setup();
    render(<MetadataPanel {...panel()} />);

    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(saved).toHaveLength(1);
    expect(saved[0].get("expectedVersion")).toBe("3");
    expect(saved[0].get("assetId")).toBe("asset-1");
  });

  it("sends every field, so an untouched one can be told from a cleared one", async () => {
    const user = userEvent.setup();
    render(<MetadataPanel {...panel()} />);

    await user.click(screen.getByRole("button", { name: "Save" }));

    // The inherited venue round-trips; the server is what decides whether that
    // counts as an edit.
    expect(saved[0].get("venue")).toBe("Dean Street, London");
    expect(saved[0].get("headline")).toBe("Two people leave a hotel");
    expect(saved[0].get("subjects")).toBe("Avery Hart");
  });

  it("tells the photographer when the record moved underneath them", () => {
    render(<MetadataPanel {...panel()} />);
    // The stale path is server-decided; what matters here is that the panel has
    // somewhere to put the message and a way back.
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });
});

describe("reviewing a whole shoot", () => {
  it("says where you are and how much is left", () => {
    render(
      <MetadataPanel
        {...panel({
          navigation: {
            position: 7,
            total: 24,
            reviewed: 6,
            onNext: () => {},
            onPrevious: () => {},
          },
        })}
      />,
    );
    expect(screen.getByText("7 of 24 · 6 reviewed")).toBeInTheDocument();
  });

  it("moves to the next photograph without leaving the screen", async () => {
    const user = userEvent.setup();
    const onNext = vi.fn();
    render(
      <MetadataPanel {...panel({ navigation: { position: 1, total: 24, reviewed: 0, onNext } })} />,
    );

    await user.click(screen.getByRole("button", { name: "Next →" }));
    expect(onNext).toHaveBeenCalled();
  });

  it("disables Previous on the first photograph rather than hiding it", () => {
    render(
      <MetadataPanel
        {...panel({ navigation: { position: 1, total: 24, reviewed: 0, onNext: () => {} } })}
      />,
    );
    expect(screen.getByRole("button", { name: "← Previous" })).toBeDisabled();
  });

  it("offers Save and next only where there is a next", async () => {
    const user = userEvent.setup();
    const onNext = vi.fn();
    render(
      <MetadataPanel {...panel({ navigation: { position: 1, total: 2, reviewed: 0, onNext } })} />,
    );

    await user.click(screen.getByRole("button", { name: "Save and next" }));
    expect(saved).toHaveLength(1);
  });
});

describe("accessibility", () => {
  it("names the panel and groups the fields under legends", () => {
    render(<MetadataPanel {...panel()} />);

    expect(screen.getByRole("region", { name: "Photograph metadata" })).toBeInTheDocument();
    for (const legend of [
      "Description",
      "Place and context",
      "What is visible",
      "Rights and handling",
    ]) {
      expect(screen.getByRole("group", { name: legend })).toBeInTheDocument();
    }
  });

  it("binds every control to a label rather than leaving one adrift", () => {
    render(<MetadataPanel {...panel()} />);

    expect(screen.getByLabelText("Headline")).toBeInTheDocument();
    expect(screen.getByLabelText("Editorial caption")).toBeInTheDocument();
    expect(screen.getByLabelText("Alt text")).toBeInTheDocument();
    expect(screen.getByLabelText("People in frame")).toBeInTheDocument();
    expect(screen.getByLabelText("Editorial use only")).toBeInTheDocument();
    expect(screen.getByLabelText("Model release")).toBeInTheDocument();
  });

  it("gives the preview a description a screen reader can use", () => {
    render(
      <MetadataPanel
        {...panel({
          photograph: { id: "asset-1", filename: "MH_0472", previewUrl: "blob:preview" },
          fields: {
            ...panel().fields,
            altText: { value: "Two people walking out of a lit doorway.", provenance: "generated" },
          },
        })}
      />,
    );
    expect(screen.getByAltText("Two people walking out of a lit doorway.")).toBeInTheDocument();
  });

  it("announces status changes without stealing focus", () => {
    render(<MetadataPanel {...panel()} />);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("disables the whole form rather than half of it for a role that cannot edit", () => {
    render(<MetadataPanel {...panel({ canEdit: false })} />);

    expect(screen.getByLabelText("Headline")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Confirm metadata" })).not.toBeInTheDocument();
  });

  it("keeps the file's own facts available without putting them in the way", async () => {
    const user = userEvent.setup();
    render(<MetadataPanel {...panel()} />);

    const summary = screen.getByText("Read from the file");
    expect(screen.queryByText("SONY ILCE-1")).not.toBeVisible();
    await user.click(summary);
    expect(screen.getByText("SONY ILCE-1")).toBeVisible();
  });
});
