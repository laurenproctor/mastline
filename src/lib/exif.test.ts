import { describe, expect, it } from "vitest";
import {
  EXIF_PREFIX_BYTES,
  formatShutterSpeed,
  gpsToDecimal,
  parseExifDateTime,
  readExif,
} from "./exif";

/**
 * A real EXIF block, built byte by byte.
 *
 * A fixture file would be simpler to write and worse to keep: it could not be
 * read to see what the parser is supposed to find, and truncating it to test a
 * partial fetch would mean checking a second binary in. Building the TIFF here
 * means every tag under test is visible in the source next to the assertion.
 */

const ASCII = 2;
const SHORT = 3;
const LONG = 4;
const RATIONAL = 5;

interface Entry {
  tag: number;
  type: number;
  values: (number | string | [number, number])[];
}

function entrySize(entry: Entry): number {
  if (entry.type === ASCII) return (entry.values[0] as string).length + 1;
  if (entry.type === RATIONAL) return entry.values.length * 8;
  if (entry.type === LONG) return entry.values.length * 4;
  return entry.values.length * 2;
}

/**
 * One directory, plus everything its entries point at.
 *
 * `base` is where this directory starts inside the TIFF, because every offset
 * in a TIFF is relative to the header rather than to the directory.
 */
function buildIfd(entries: Entry[], base: number): { bytes: Uint8Array; size: number } {
  const directoryBytes = 2 + entries.length * 12 + 4;
  const valueStart = base + directoryBytes;

  const values: number[] = [];
  const buffer = new Uint8Array(directoryBytes);
  const view = new DataView(buffer.buffer);

  view.setUint16(0, entries.length, true);

  entries.forEach((entry, index) => {
    const at = 2 + index * 12;
    const size = entrySize(entry);
    const count = entry.type === ASCII ? size : entry.values.length;

    view.setUint16(at, entry.tag, true);
    view.setUint16(at + 2, entry.type, true);
    view.setUint32(at + 4, count, true);

    const inline = size <= 4;
    const target = inline ? null : valueStart + values.length;

    const written: number[] = [];
    if (entry.type === ASCII) {
      const text = entry.values[0] as string;
      for (const character of text) written.push(character.charCodeAt(0));
      written.push(0);
    } else {
      for (const value of entry.values) {
        if (entry.type === RATIONAL) {
          const [numerator, denominator] = value as [number, number];
          const scratch = new DataView(new ArrayBuffer(8));
          scratch.setUint32(0, numerator, true);
          scratch.setUint32(4, denominator, true);
          for (let byte = 0; byte < 8; byte += 1) written.push(scratch.getUint8(byte));
        } else if (entry.type === LONG) {
          const scratch = new DataView(new ArrayBuffer(4));
          scratch.setUint32(0, value as number, true);
          for (let byte = 0; byte < 4; byte += 1) written.push(scratch.getUint8(byte));
        } else {
          const scratch = new DataView(new ArrayBuffer(2));
          scratch.setUint16(0, value as number, true);
          for (let byte = 0; byte < 2; byte += 1) written.push(scratch.getUint8(byte));
        }
      }
    }

    if (inline) {
      written.forEach((byte, offset) => view.setUint8(at + 8 + offset, byte));
    } else {
      view.setUint32(at + 8, target as number, true);
      values.push(...written);
    }
  });

  const bytes = new Uint8Array(directoryBytes + values.length);
  bytes.set(buffer, 0);
  bytes.set(Uint8Array.from(values), directoryBytes);
  return { bytes, size: bytes.length };
}

function buildTiff(): Uint8Array {
  // The three directories are laid out head to tail: IFD0, then the Exif
  // sub-directory, then GPS. IFD0's pointers are filled in once the sizes of
  // the two that follow are known.
  const header = 8;

  const exifEntries: Entry[] = [
    { tag: 0x829a, type: RATIONAL, values: [[1, 250]] },
    { tag: 0x829d, type: RATIONAL, values: [[28, 10]] },
    { tag: 0x8827, type: SHORT, values: [800] },
    { tag: 0x9003, type: ASCII, values: ["2026:08:19 18:47:03"] },
    { tag: 0x9011, type: ASCII, values: ["+01:00"] },
    { tag: 0x920a, type: RATIONAL, values: [[200, 1]] },
    { tag: 0xa001, type: SHORT, values: [1] },
    { tag: 0xa434, type: ASCII, values: ["FE 70-200mm F2.8 GM OSS II"] },
  ];

  const gpsEntries: Entry[] = [
    { tag: 1, type: ASCII, values: ["N"] },
    {
      tag: 2,
      type: RATIONAL,
      values: [
        [51, 1],
        [30, 1],
        [1013, 100],
      ],
    },
    { tag: 3, type: ASCII, values: ["W"] },
    {
      tag: 4,
      type: RATIONAL,
      values: [
        [0, 1],
        [7, 1],
        [2394, 100],
      ],
    },
  ];

  // Sizes first, with placeholder bases, so the pointers can be computed.
  const exifProbe = buildIfd(exifEntries, 0);
  const ifd0Entries: Entry[] = [
    { tag: 0x010f, type: ASCII, values: ["SONY"] },
    { tag: 0x0110, type: ASCII, values: ["ILCE-1"] },
    { tag: 0x0112, type: SHORT, values: [6] },
    { tag: 0x0131, type: ASCII, values: ["Mastline test"] },
    { tag: 0x8769, type: LONG, values: [0] },
    { tag: 0x8825, type: LONG, values: [0] },
  ];

  const ifd0Probe = buildIfd(ifd0Entries, header);
  const exifBase = header + ifd0Probe.size;
  const gpsBase = exifBase + exifProbe.size;

  ifd0Entries[4].values = [exifBase];
  ifd0Entries[5].values = [gpsBase];

  const ifd0 = buildIfd(ifd0Entries, header);
  const exif = buildIfd(exifEntries, exifBase);
  const gps = buildIfd(gpsEntries, gpsBase);

  const tiff = new Uint8Array(header + ifd0.size + exif.size + gps.size);
  const view = new DataView(tiff.buffer);
  view.setUint8(0, 0x49);
  view.setUint8(1, 0x49);
  view.setUint16(2, 42, true);
  view.setUint32(4, header, true);

  tiff.set(ifd0.bytes, header);
  tiff.set(exif.bytes, exifBase);
  tiff.set(gps.bytes, gpsBase);
  return tiff;
}

function buildJpeg(tiff: Uint8Array): Uint8Array {
  const marker = new TextEncoder().encode("Exif\0\0");
  const segment = marker.length + tiff.length;
  const bytes = new Uint8Array(2 + 2 + 2 + segment + 2);
  const view = new DataView(bytes.buffer);

  view.setUint16(0, 0xffd8, false); // SOI
  view.setUint16(2, 0xffe1, false); // APP1
  view.setUint16(4, segment + 2, false);
  bytes.set(marker, 6);
  bytes.set(tiff, 6 + marker.length);
  view.setUint16(bytes.length - 2, 0xffd9, false); // EOI
  return bytes;
}

describe("readExif", () => {
  const facts = readExif(buildJpeg(buildTiff()));

  it("reads the body, the lens, and the exposure a photographer would quote", () => {
    expect(facts.cameraMake).toBe("SONY");
    expect(facts.cameraModel).toBe("ILCE-1");
    expect(facts.lens).toBe("FE 70-200mm F2.8 GM OSS II");
    expect(facts.focalLengthMm).toBe(200);
    expect(facts.apertureF).toBe(2.8);
    expect(facts.iso).toBe(800);
    expect(facts.shutterSpeed).toBe("1/250");
    expect(facts.shutterSpeedSeconds).toBeCloseTo(0.004, 5);
    expect(facts.orientation).toBe(6);
    expect(facts.colorProfile).toBe("sRGB");
  });

  it("applies the recorded offset rather than assuming the camera was on UTC", () => {
    // 18:47:03 +01:00 is 17:47:03 Z. Getting this wrong puts a frame an hour
    // out in an archive that sorts on it.
    expect(facts.capturedAt).toBe("2026-08-19T17:47:03.000Z");
    expect(facts.capturedAtHasZone).toBe(true);
  });

  it("converts GPS to signed decimal degrees", () => {
    expect(facts.gpsLatitude).toBeCloseTo(51.5028, 4);
    // West is negative. A sign error here places a London frame in Kazakhstan.
    expect(facts.gpsLongitude).toBeCloseTo(-0.1233, 4);
  });

  it("keeps recognised tags it has no column for", () => {
    expect(facts.extra.software).toBe("Mastline test");
  });

  it("reads a bare TIFF, which is what a RAW container is", () => {
    const raw = readExif(buildTiff());
    expect(raw.cameraModel).toBe("ILCE-1");
  });
});

describe("readExif on files with nothing to read", () => {
  it("returns empty rather than throwing for a file with no tags", () => {
    // A JPEG with no APP1 at all: a screenshot, or a frame an editor stripped.
    const bare = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(readExif(bare)).toEqual({ extra: {} });
  });

  it("returns empty for something that is not an image at all", () => {
    expect(readExif(new TextEncoder().encode("this is not a photograph"))).toEqual({ extra: {} });
  });

  it("survives a truncated file rather than reading off the end", () => {
    const full = buildJpeg(buildTiff());
    // Cut inside the value block, so offsets point past the buffer.
    const truncated = full.subarray(0, 40);
    expect(() => readExif(truncated)).not.toThrow();
  });

  it("survives a directory claiming an impossible number of entries", () => {
    const tiff = buildTiff();
    new DataView(tiff.buffer).setUint16(8, 60000, true);
    expect(readExif(tiff)).toEqual({ extra: {} });
  });
});

describe("parseExifDateTime", () => {
  it("treats a time with no offset as UTC and says that it did", () => {
    const parsed = parseExifDateTime("2026:08:19 18:47:03");
    expect(parsed).toEqual({ iso: "2026-08-19T18:47:03.000Z", hasZone: false });
  });

  it("refuses a clock nobody set", () => {
    // A body with a dead battery reports 1980, which would file the frame at
    // the wrong end of the archive permanently.
    expect(parseExifDateTime("1980:01:01 00:00:00")).toBeNull();
  });

  it("refuses something that is not a date", () => {
    expect(parseExifDateTime("not a date")).toBeNull();
    expect(parseExifDateTime(undefined)).toBeNull();
  });

  it("ignores a malformed offset instead of applying it", () => {
    expect(parseExifDateTime("2026:08:19 18:47:03", "nonsense")?.hasZone).toBe(false);
  });
});

describe("gpsToDecimal", () => {
  it("returns undefined rather than a wrong answer for a partial triple", () => {
    expect(gpsToDecimal([51, 30], "N")).toBeUndefined();
    expect(gpsToDecimal(undefined, "N")).toBeUndefined();
  });

  it("refuses a magnitude no coordinate can have", () => {
    expect(gpsToDecimal([900, 0, 0], "N")).toBeUndefined();
  });
});

describe("formatShutterSpeed", () => {
  it("writes fast exposures as a fraction and slow ones in seconds", () => {
    expect(formatShutterSpeed(1 / 1000)).toBe("1/1000");
    expect(formatShutterSpeed(2.5)).toBe("2.5 s");
    expect(formatShutterSpeed(0)).toBe("");
  });
});

describe("EXIF_PREFIX_BYTES", () => {
  it("is large enough for a header and an ICC profile, small enough not to be a download", () => {
    expect(EXIF_PREFIX_BYTES).toBeGreaterThanOrEqual(64 * 1024);
    expect(EXIF_PREFIX_BYTES).toBeLessThanOrEqual(1024 * 1024);
  });
});
