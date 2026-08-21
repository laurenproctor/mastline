import { describe, expect, it } from "vitest";
import { canPreview, formatBytes } from "./upload";

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
