import { describe, expect, it } from "vitest";
import type { ArchiveResult } from "@/lib/data/archive";
import { money } from "@/lib/money";
import { workspaceRoutes } from "@/lib/workspace-routes";
import {
  activeConstraints,
  archiveHref,
  commercialState,
  pageWindow,
  parseArchiveState,
  resultRange,
  toArchiveCard,
} from "./archive-view-model";

const routes = workspaceRoutes("marcus-hale-studio");

function result(overrides: Partial<ArchiveResult> = {}): ArchiveResult {
  return {
    assetId: "a0000000-0000-0000-0000-0000000000d1",
    canonicalFilename: "MH_0819_0472",
    headline: "Avery Hart departs Hotel Chelsea",
    caption: "Avery Hart leaves the Hotel Chelsea after the cast announcement.",
    capturedAt: "2026-08-19T18:47:18Z",
    lifetimeEarnings: money(0),
    submissionCount: 0,
    ...overrides,
  };
}

describe("reading the address", () => {
  it("falls back to the defaults for anything it does not recognise", () => {
    expect(parseArchiveState({ filter: "hot", page: "banana", view: "masonry" })).toEqual({
      query: "",
      filter: "all",
      page: 1,
      view: "grid",
    });
  });

  it("keeps a query, a known filter, a page, and the list view", () => {
    expect(
      parseArchiveState({ q: "  Avery Hart ", filter: "earning", page: "3", view: "list" }),
    ).toEqual({
      query: "Avery Hart",
      filter: "earning",
      page: 3,
      view: "list",
    });
  });

  it("never yields a page below one", () => {
    expect(parseArchiveState({ page: "0" }).page).toBe(1);
    expect(parseArchiveState({ page: "-4" }).page).toBe(1);
  });
});

describe("building an address", () => {
  const state = parseArchiveState({ q: "Avery Hart", filter: "earning", page: "3", view: "list" });

  it("drops the defaults so the plain archive has the plain address", () => {
    expect(archiveHref(routes, parseArchiveState({}))).toBe("/marcus-hale-studio/archive");
  });

  it("carries the whole state when nothing changes", () => {
    expect(archiveHref(routes, state)).toBe(
      "/marcus-hale-studio/archive?q=Avery+Hart&filter=earning&view=list&page=3",
    );
  });

  it("starts from the first page when the query or filter changes", () => {
    expect(archiveHref(routes, state, { filter: "unsold" })).not.toContain("page=");
    expect(archiveHref(routes, state, { query: "Chelsea" })).not.toContain("page=");
  });

  it("keeps the page when only the view changes", () => {
    expect(archiveHref(routes, state, { view: "grid" })).toBe(
      "/marcus-hale-studio/archive?q=Avery+Hart&filter=earning&page=3",
    );
  });

  it("stays inside the workspace", () => {
    expect(archiveHref(routes, state, { page: 2 }).startsWith("/marcus-hale-studio/")).toBe(true);
  });
});

describe("commercial state", () => {
  it("is 'never sent' for an asset in no package with nothing recorded", () => {
    expect(commercialState(result())).toEqual({ kind: "never_sent", label: "Never sent" });
  });

  it("counts packages for an asset that went out but has no recorded sale", () => {
    expect(commercialState(result({ submissionCount: 1 }))).toEqual({
      kind: "sent",
      label: "1 package",
      detail: "No recorded sale",
    });
    expect(commercialState(result({ submissionCount: 2 })).label).toBe("2 packages");
  });

  it("shows the recorded amount, and the packages, for an asset that earned", () => {
    expect(
      commercialState(result({ submissionCount: 2, lifetimeEarnings: money(44_800) })),
    ).toEqual({
      kind: "earned",
      label: "Has earned",
      detail: "2 packages",
      amount: "$448",
    });
  });

  it("does not invent a package count for earnings recorded outside one", () => {
    const state = commercialState(result({ lifetimeEarnings: money(10_000) }));
    expect(state.kind).toBe("earned");
    expect(state.detail).toBeUndefined();
  });

  it("treats a net refund as not having earned", () => {
    expect(
      commercialState(result({ lifetimeEarnings: money(-500), submissionCount: 1 })).kind,
    ).toBe("sent");
  });
});

describe("a card", () => {
  it("links to the asset inside the workspace and formats the capture date", () => {
    const card = toArchiveCard(result(), routes, new Map());
    expect(card.href).toBe("/marcus-hale-studio/assets/a0000000-0000-0000-0000-0000000000d1");
    expect(card.title).toBe("Avery Hart departs Hotel Chelsea");
    expect(card.titleIsFilename).toBe(false);
    expect(card.capturedLabel).toBe("Aug 19, 2026");
    expect(card.previewUrl).toBeUndefined();
  });

  it("stands the filename in for a missing headline, and says so", () => {
    const card = toArchiveCard(result({ headline: undefined }), routes, new Map());
    expect(card.title).toBe("MH_0819_0472");
    expect(card.titleIsFilename).toBe(true);
  });

  it("drops a caption that only repeats the headline", () => {
    const card = toArchiveCard(
      result({ caption: "Avery Hart departs Hotel Chelsea" }),
      routes,
      new Map(),
    );
    expect(card.caption).toBeUndefined();
  });

  it("uses the signed preview when one was minted for its key", () => {
    const card = toArchiveCard(
      result({ previewObjectKey: "org/derivatives/x/preview.jpg" }),
      routes,
      new Map([["org/derivatives/x/preview.jpg", "https://signed.example/preview"]]),
    );
    expect(card.previewUrl).toBe("https://signed.example/preview");
  });

  it("has no date when none was captured", () => {
    const card = toArchiveCard(result({ capturedAt: undefined }), routes, new Map());
    expect(card.capturedAt).toBeUndefined();
    expect(card.capturedLabel).toBeUndefined();
  });
});

describe("active constraints", () => {
  it("is empty when nothing narrows the results", () => {
    expect(activeConstraints(routes, parseArchiveState({}))).toEqual([]);
  });

  it("offers each constraint with the address that drops only it", () => {
    const state = parseArchiveState({ q: "Avery Hart", filter: "earning" });
    const chips = activeConstraints(routes, state);
    expect(chips.map((chip) => chip.label)).toEqual(["“Avery Hart”", "Has earned"]);
    expect(chips[0].removeHref).toBe("/marcus-hale-studio/archive?filter=earning");
    expect(chips[1].removeHref).toBe("/marcus-hale-studio/archive?q=Avery+Hart");
  });
});

describe("pages", () => {
  it("lists every page when there are few", () => {
    expect(pageWindow(1, 1)).toEqual([1]);
    expect(pageWindow(3, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("keeps the ends and the neighbourhood of the current page", () => {
    expect(pageWindow(1, 286)).toEqual([1, 2, 3, 4, "gap", 286]);
    expect(pageWindow(50, 286)).toEqual([1, "gap", 49, 50, 51, "gap", 286]);
    expect(pageWindow(286, 286)).toEqual([1, "gap", 283, 284, 285, 286]);
  });

  it("never grows past seven entries", () => {
    for (let page = 1; page <= 40; page += 1) {
      expect(pageWindow(page, 40).length).toBeLessThanOrEqual(7);
    }
  });

  it("describes the rows on a page, clamped to the total", () => {
    expect(resultRange(1, 24, 89)).toEqual({ from: 1, to: 24 });
    expect(resultRange(4, 24, 89)).toEqual({ from: 73, to: 89 });
    expect(resultRange(1, 24, 0)).toEqual({ from: 0, to: 0 });
  });
});
