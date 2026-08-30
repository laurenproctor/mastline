/**
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";
import { watermarkPreview } from "./watermark.server";

/**
 * The image library, on the platform running the tests.
 *
 * Everything else about the mark is tested without sharp (see
 * ../watermark.test.ts). This file exists to prove the native library itself
 * loads and works from the lockfile's own install -- on a developer machine
 * that is macOS; in CI it is the Linux x64 runner, which is the platform the
 * production function runs on. A lockfile that resolves the wrong platform
 * packages, or a sharp/libvips pair that does not match, fails here rather
 * than in a recipient's browser.
 */

/** A tiny in-memory source: SVG in, so no binary fixture is committed. */
const SOURCE = Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200">
     <rect width="320" height="200" fill="#1f48ff"/>
     <circle cx="160" cy="100" r="60" fill="#c7f000"/>
   </svg>`,
);

describe("sharp runtime", () => {
  it("loads the native library and renders a marked JPEG from an in-memory image", async () => {
    const { body, contentType } = await watermarkPreview(SOURCE, {
      recipient: "Runtime check desk",
      credit: "Mastline",
      sentOn: "30 Aug 2026",
    });

    expect(contentType).toBe("image/jpeg");
    expect(body.length).toBeGreaterThan(1_000);
    // A JPEG starts with the SOI marker and ends with EOI: readable, complete.
    expect(body.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
    expect(body.subarray(body.length - 2)).toEqual(Buffer.from([0xff, 0xd9]));

    // The library reads its own output back: dimensions are the source's.
    const sharp = (await import("sharp")).default;
    const metadata = await sharp(body).metadata();
    expect(metadata.format).toBe("jpeg");
    expect(metadata.width).toBe(320);
    expect(metadata.height).toBe(200);
  });

  it("refuses to mark something that is not an image", async () => {
    await expect(
      watermarkPreview(Buffer.from("not an image"), { recipient: "Desk" }),
    ).rejects.toBeTruthy();
  });
});
