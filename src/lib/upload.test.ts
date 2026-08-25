import { describe, expect, it } from "vitest";
import { canPreview, centreSquare, formatBytes } from "./upload";

describe("preview support", () => {
  it.each(["image/jpeg", "image/png", "image/webp", "image/avif"])("can preview %s", (mime) => {
    expect(canPreview(mime)).toBe(true);
  });

  it.each(["image/x-sony-arw", "image/x-canon-cr3", "image/x-nikon-nef", "video/mp4"])(
    "does not claim to preview %s",
    (mime) => {
      expect(canPreview(mime)).toBe(false);
    },
  );
});

describe("centreSquare", () => {
  it("takes the whole frame when it is already square", () => {
    expect(centreSquare(400, 400)).toEqual({ x: 0, y: 0, edge: 400 });
  });

  it("crops the sides of a landscape frame, evenly", () => {
    // 1000 wide, 600 tall: a 600 square with 200 trimmed from each side.
    expect(centreSquare(1000, 600)).toEqual({ x: 200, y: 0, edge: 600 });
  });

  it("crops the top and bottom of a portrait frame, evenly", () => {
    expect(centreSquare(600, 1000)).toEqual({ x: 0, y: 200, edge: 600 });
  });

  it("keeps the crop inside the frame when the odd pixel cannot be split", () => {
    const { x, edge } = centreSquare(101, 100);
    expect(edge).toBe(100);
    // Rounding must not push the right edge past 101.
    expect(x + edge).toBeLessThanOrEqual(101);
  });

  it("survives a one-pixel image rather than returning a zero edge", () => {
    expect(centreSquare(1, 1)).toEqual({ x: 0, y: 0, edge: 1 });
  });
});

describe("formatBytes", () => {
  it.each([
    [0, "0 B"],
    [512, "512 B"],
    [1024, "1.0 KB"],
    [1536, "1.5 KB"],
    [1048576, "1.0 MB"],
    [52428800, "50 MB"],
    [5368709120, "5.0 GB"],
  ])("renders %i as %s", (bytes, expected) => {
    expect(formatBytes(bytes)).toBe(expected);
  });
});
