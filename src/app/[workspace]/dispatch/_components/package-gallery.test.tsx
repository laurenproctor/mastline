import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

/*
 * The inline fix form posts to the asset-metadata server action, which reaches
 * server-only data modules. What these tests are about is the markup around it:
 * which fields appear, and when. The action itself is covered where it lives.
 */
vi.mock("../../shoots/actions", () => ({
  saveAssetMetadataAction: vi.fn(async () => ({ ok: true, message: "Saved." })),
}));
import { PackageGallery, type ReviewFrame } from "./package-gallery";

/**
 * The gallery a photographer approves from.
 *
 * These assertions are mostly about restraint: what must appear under a
 * photograph, what must never appear there, and what must stay reachable
 * somewhere else. A package nobody can fully inspect is a package nobody should
 * be asked to approve.
 */

const frame = (over: Partial<ReviewFrame> = {}): ReviewFrame => ({
  assetId: `a-${over.position ?? 0}`,
  position: over.position ?? 0,
  assetHref: "/studio/assets/a-0",
  previewUrl: "https://storage.example.test/derivatives/signed?token=abc",
  assetKind: "image",
  filename: "MH_0819_0472.jpg",
  headline: "Woman exits SoHo hotel",
  caption: "A woman in black leaves a SoHo hotel and walks toward a waiting car.",
  captionAwaitsReview: false,
  captionOrigin: "human",
  people: ["Unidentified woman"],
  credit: "Marcus Hale",
  copyright: "© Marcus Hale",
  location: "SoHo, New York",
  usageRestrictions: "Editorial use only",
  capturedAt: "2026-08-19T22:14:00.000Z",
  versionKind: "Delivery",
  sha256: "abcdef0123456789abcdef",
  width: 2048,
  height: 1365,
  mimeType: "image/jpeg",
  bytes: 2_400_000,
  missingRequired: [],
  missingRecommended: [],
  ...over,
});

const three = [frame({ position: 0 }), frame({ position: 1 }), frame({ position: 2 })];

/** The two routing props every render needs, and frame editing off by default. */
function gallery(props: Partial<Parameters<typeof PackageGallery>[0]> = {}) {
  return (
    <PackageGallery
      frames={props.frames ?? [frame()]}
      canEditFrames={props.canEditFrames}
      restrictions={props.restrictions}
      shootId="shoot-1"
      terms={props.terms}
      workspaceSlug="studio"
    />
  );
}

describe("the package gallery", () => {
  it("renders the real signed preview, not a stand-in", () => {
    render(gallery({ frames: [frame()] }));
    const image = screen.getByRole("img", { name: "Woman exits SoHo hotel" });
    expect(image).toHaveAttribute("src", expect.stringContaining("derivatives"));
  });

  it("says so in words when there is no preview, and still names the frame", () => {
    render(
      <PackageGallery
        shootId="shoot-1"
        workspaceSlug="studio"
        frames={[frame({ previewUrl: undefined })]}
      />,
    );
    expect(screen.getByText("No preview available")).toBeInTheDocument();
    // The reviewer can still tell which frame it is.
    expect(screen.getByText("MH_0819_0472.jpg")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("labels a video without inventing a duration", () => {
    render(
      <PackageGallery
        shootId="shoot-1"
        workspaceSlug="studio"
        frames={[frame({ assetKind: "video" })]}
      />,
    );
    expect(screen.getByText("Video")).toBeInTheDocument();
    expect(screen.queryByText(/\d+:\d\d/)).not.toBeInTheDocument();
  });

  it("shows headline, caption and people, in that order and only those", () => {
    render(gallery({ frames: [frame()] }));
    const terms = screen.getAllByRole("term").map((node) => node.textContent);
    expect(terms).toEqual(["Headline", "Caption", "People"]);
  });

  it("takes all three from the stored asset", () => {
    render(gallery({ frames: [frame()] }));
    expect(screen.getByText("Woman exits SoHo hotel")).toBeInTheDocument();
    expect(screen.getByText(/leaves a SoHo hotel/)).toBeInTheDocument();
    expect(screen.getByText("Unidentified woman")).toBeInTheDocument();
  });

  it("reads several people as a list", () => {
    render(
      <PackageGallery
        shootId="shoot-1"
        workspaceSlug="studio"
        frames={[frame({ people: ["Julian Cross", "Nadia Sol"] })]}
      />,
    );
    expect(screen.getByText("Julian Cross, Nadia Sol")).toBeInTheDocument();
  });

  it("is explicit about a missing headline rather than inventing one", () => {
    render(
      <PackageGallery
        shootId="shoot-1"
        workspaceSlug="studio"
        frames={[frame({ headline: undefined })]}
      />,
    );
    expect(screen.getByText("Headline missing")).toBeInTheDocument();
  });

  it("is explicit about a missing caption", () => {
    render(
      <PackageGallery
        shootId="shoot-1"
        workspaceSlug="studio"
        frames={[frame({ caption: undefined })]}
      />,
    );
    expect(screen.getByText("Caption missing")).toBeInTheDocument();
  });

  it("says people are not identified rather than leaving a blank", () => {
    render(
      <PackageGallery shootId="shoot-1" workspaceSlug="studio" frames={[frame({ people: [] })]} />,
    );
    expect(screen.getByText("People not identified")).toBeInTheDocument();
  });

  /*
   * Text existing is not the same as text somebody stands behind. A caption the
   * writer drafted and nobody has read has to say so on the frame, in words.
   */
  it("marks a drafted caption nobody has reviewed", () => {
    render(
      <PackageGallery
        shootId="shoot-1"
        workspaceSlug="studio"
        frames={[frame({ captionOrigin: "model", captionAwaitsReview: true })]}
      />,
    );
    expect(screen.getByText("Caption awaiting review")).toBeInTheDocument();
  });

  it("leaves a reviewed caption unmarked", () => {
    render(
      <PackageGallery
        shootId="shoot-1"
        workspaceSlug="studio"
        frames={[frame({ captionAwaitsReview: false })]}
      />,
    );
    expect(screen.queryByText("Caption awaiting review")).not.toBeInTheDocument();
  });

  /*
   * The restraint that makes the screen editorial rather than technical. All of
   * this is still available -- one control away, asserted below -- and none of
   * it belongs under a photograph somebody is reading.
   */
  it("keeps technical metadata out from under the photograph", () => {
    render(gallery({ frames: [frame()] }));
    for (const forbidden of [
      "MH_0819_0472.jpg",
      "image/jpeg",
      "2048",
      "abcdef0123",
      "Delivery",
      "2.3 MB",
    ]) {
      expect(screen.queryByText(new RegExp(forbidden, "i")), forbidden).not.toBeInTheDocument();
    }
  });

  it("keeps the full caption reachable without a hover", async () => {
    const long = "x".repeat(400);
    render(
      <PackageGallery
        shootId="shoot-1"
        workspaceSlug="studio"
        frames={[frame({ caption: long })]}
      />,
    );
    const more = screen.getByRole("button", { name: /read the full caption/i });
    expect(more).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(more);
    expect(screen.getByRole("button", { name: /show less/i })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });
});

describe("reaching every frame", () => {
  it("shows three and counts the rest from the real total", () => {
    const twelve = Array.from({ length: 12 }, (_, i) => frame({ position: i, assetId: `a-${i}` }));
    render(gallery({ frames: twelve }));
    expect(screen.getByRole("button", { name: /\+9 frames/i })).toBeInTheDocument();
    expect(screen.getByText("Total 12 frames")).toBeInTheDocument();
  });

  it("offers no expander when everything already fits", () => {
    render(gallery({ frames: three }));
    expect(screen.queryByRole("button", { name: /\+\d+ frame/i })).not.toBeInTheDocument();
  });

  it("opens every remaining frame, with the same editorial fields", async () => {
    const five = Array.from({ length: 5 }, (_, i) =>
      frame({ position: i, assetId: `a-${i}`, headline: `Frame headline ${i}` }),
    );
    render(gallery({ frames: five }));

    expect(screen.queryByText("Frame headline 4")).not.toBeInTheDocument();

    const expander = screen.getByRole("button", { name: /\+2 frames/i });
    expect(expander).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(expander);

    expect(expander).toHaveAttribute("aria-expanded", "true");
    for (let i = 0; i < 5; i += 1) {
      expect(screen.getByText(`Frame headline ${i}`)).toBeInTheDocument();
    }
    // Every one of them still carries the three primary fields.
    expect(screen.getAllByRole("term").filter((n) => n.textContent === "People")).toHaveLength(5);
  });

  it("keeps package order", async () => {
    const five = Array.from({ length: 5 }, (_, i) =>
      frame({ position: i, assetId: `a-${i}`, headline: `Frame headline ${i}` }),
    );
    render(gallery({ frames: five }));
    await userEvent.click(screen.getByRole("button", { name: /\+2 frames/i }));
    const headlines = screen.getAllByText(/Frame headline \d/).map((node) => node.textContent);
    expect(headlines).toEqual([
      "Frame headline 0",
      "Frame headline 1",
      "Frame headline 2",
      "Frame headline 3",
      "Frame headline 4",
    ]);
  });
});

describe("frame details", () => {
  async function openDetails() {
    render(gallery({ frames: [frame()] }));
    await userEvent.click(screen.getByRole("button", { name: "Frame details" }));
  }

  it("keeps every piece of technical evidence the manifest carried", async () => {
    await openDetails();
    expect(screen.getByRole("link", { name: "MH_0819_0472.jpg" })).toBeInTheDocument();
    expect(screen.getByText("Delivery")).toBeInTheDocument();
    expect(screen.getByText(/abcdef012345…/)).toBeInTheDocument();
    expect(screen.getByText("2048 × 1365")).toBeInTheDocument();
    expect(screen.getByText("image/jpeg")).toBeInTheDocument();
    expect(screen.getByText("2.3 MB")).toBeInTheDocument();
    expect(screen.getByText("SoHo, New York")).toBeInTheDocument();
    expect(screen.getByText("Marcus Hale")).toBeInTheDocument();
  });

  it("states caption provenance rather than a badge", async () => {
    render(
      <PackageGallery
        shootId="shoot-1"
        workspaceSlug="studio"
        frames={[frame({ captionOrigin: "model", captionAwaitsReview: true })]}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Frame details" }));
    expect(screen.getByText("Drafted by the caption writer, awaiting review")).toBeInTheDocument();
  });

  it("keeps missing required and recommended metadata visible", async () => {
    render(
      <PackageGallery
        shootId="shoot-1"
        workspaceSlug="studio"
        frames={[frame({ missingRequired: ["Caption"], missingRecommended: ["Location"] })]}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Frame details" }));
    expect(screen.getByText(/Missing required: Caption/)).toBeInTheDocument();
    expect(screen.getByText(/Missing recommended: Location/)).toBeInTheDocument();
  });
});

describe("desk preview", () => {
  it("shows what a desk would read, and says nothing has been created", async () => {
    render(
      <PackageGallery
        shootId="shoot-1"
        workspaceSlug="studio"
        frames={[frame()]}
        terms="$1,200 asking"
        restrictions="Editorial only"
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Desk preview" }));

    expect(screen.getByText("$1,200 asking")).toBeInTheDocument();
    expect(screen.getByText("Editorial only")).toBeInTheDocument();
    expect(screen.getByText(/No recipient link exists yet/i)).toBeInTheDocument();
  });

  it("never claims a send, a share, or a watermark", async () => {
    render(gallery({ frames: [frame()] }));
    await userEvent.click(screen.getByRole("button", { name: "Desk preview" }));
    const body = document.body.textContent ?? "";

    /*
     * Looking for the affirmative claim, not the word. The copy uses "shared"
     * and "watermarked" inside the sentence that denies both, and an assertion
     * that cannot tell those apart would force the page to stop saying the
     * true thing.
     */
    for (const claim of [
      /has been sent/i,
      /was sent/i,
      /has been shared/i,
      /marked as shared/i,
      /has been delivered/i,
      // Not "watermarked for anybody", which is the denial.
      /watermarked for (?!anybody)[a-z]/i,
    ]) {
      expect(body, String(claim)).not.toMatch(claim);
    }

    expect(body).toMatch(/nothing here has been created, shared, or watermarked/i);
  });
});

/*
 * A blocked package has to say what is wrong AND let somebody put it right.
 * Naming the problem and then offering nowhere to solve it is the failure this
 * whole section exists to prevent.
 */
describe("fixing what is blocking", () => {
  const broken = frame({ missingRequired: ["Caption", "Credit"], caption: undefined });

  it("names the frames that need work, and what each one is missing", () => {
    render(gallery({ frames: [broken], canEditFrames: true }));
    expect(screen.getByRole("heading", { name: /1 frame needs work/i })).toBeInTheDocument();
    expect(screen.getByText(/missing Caption, Credit/)).toBeInTheDocument();
  });

  it("counts several frames rather than reporting a bare check", () => {
    render(
      gallery({
        frames: [
          broken,
          frame({ position: 1, assetId: "a-1" }),
          { ...broken, position: 2, assetId: "a-2" },
        ],
        canEditFrames: true,
      }),
    );
    expect(screen.getByRole("heading", { name: /2 frames need work/i })).toBeInTheDocument();
  });

  it("opens an editor on the frame, asking only for what is missing", async () => {
    render(gallery({ frames: [broken], canEditFrames: true }));
    await userEvent.click(screen.getByRole("button", { name: "Fix" }));

    expect(screen.getByLabelText("Caption")).toBeInTheDocument();
    expect(screen.getByLabelText("Credit")).toBeInTheDocument();
    // Not the fields that are already fine.
    expect(screen.queryByLabelText("Location")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Copyright")).not.toBeInTheDocument();
  });

  it("reveals a hidden frame when its fix is opened from the summary", async () => {
    const twelve = Array.from({ length: 12 }, (_, i) =>
      frame({ position: i, assetId: `a-${i}`, headline: `Frame ${i}` }),
    );
    twelve[9] = { ...twelve[9], missingRequired: ["Caption"], caption: undefined };

    render(gallery({ frames: twelve, canEditFrames: true }));
    // Frame 9 is behind the +N control.
    expect(screen.queryByText("Frame 9")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Fix" }));
    expect(screen.getByText("Frame 9")).toBeInTheDocument();
    expect(screen.getByLabelText("Caption")).toBeInTheDocument();
  });

  it("carries the fields it is not asking about, so a save cannot clear them", async () => {
    const { container } = render(gallery({ frames: [broken], canEditFrames: true }));
    await userEvent.click(screen.getByRole("button", { name: "Fix" }));

    const hidden = Array.from(container.querySelectorAll('input[type="hidden"]')).map((n) => [
      n.getAttribute("name"),
      n.getAttribute("value"),
    ]);
    expect(hidden).toEqual(
      expect.arrayContaining([
        ["headline", "Woman exits SoHo hotel"],
        ["locationName", "SoHo, New York"],
        ["copyrightNotice", "© Marcus Hale"],
      ]),
    );
  });

  /*
   * Capture time is read off the file at import. A control to type one would
   * invite somebody to invent when a photograph was taken.
   */
  it("refuses to offer a capture time field, and says why", async () => {
    render(
      gallery({
        frames: [{ ...broken, missingRequired: ["Capture time"] }],
        canEditFrames: true,
      }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Fix" }));
    expect(screen.queryByLabelText(/capture/i)).not.toBeInTheDocument();
    expect(screen.getByText(/cannot be set here/i)).toBeInTheDocument();
    expect(screen.getByText(/Re-import the frame/i)).toBeInTheDocument();
  });

  it("offers reading, not editing, without the permission", () => {
    render(gallery({ frames: [broken], canEditFrames: false }));
    expect(screen.getByText(/1 frame needs work/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Fix" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /open/i }).length).toBeGreaterThan(0);
  });

  it("says nothing about blockers when every frame is complete", () => {
    render(gallery({ frames: three, canEditFrames: true }));
    expect(screen.queryByText(/needs work/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Fix this frame" })).not.toBeInTheDocument();
  });
});
