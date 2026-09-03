/**
 * Reading what the camera wrote.
 *
 * A frame arrives carrying facts nobody has to type: the body, the lens, the
 * exposure, the moment the shutter fired, sometimes the coordinates. Those are
 * the only metadata in this product that are neither inferred nor typed, and
 * they are worth having exactly because of that -- a capture time read from the
 * file settles an argument a caption cannot.
 *
 * WHY THIS IS HAND-WRITTEN
 *
 * Adding a parser dependency needs asking, and the format does not warrant one.
 * EXIF is a TIFF directory bolted onto a container; the whole of what this
 * product needs is roughly twenty tags across three directories. What a library
 * would buy is breadth this product does not use (maker notes, thumbnails,
 * XMP), at the cost of a supply-chain surface sitting in the path of every
 * uploaded file.
 *
 * WHAT IT READS
 *
 *   - JPEG: the APP1 segment holding "Exif\0\0", and the APP2 chain holding an
 *     ICC profile.
 *   - TIFF, and the RAW formats built on it -- ARW, CR2, NEF, DNG, ORF, RAF
 *     partially -- by treating the file as a TIFF directly.
 *   - PNG: the eXIf chunk, where one exists.
 *
 * Anything else returns nothing, which is a valid answer. A file with no tags
 * is normal: a phone screenshot, a frame exported by an editor that stripped
 * them, a video container. The metadata record says so rather than guessing.
 *
 * EVERYTHING HERE IS DEFENSIVE
 *
 * This runs over bytes that arrived from outside. Every read is bounds-checked
 * and every failure is local: a malformed directory yields the tags read before
 * it rather than an exception, because a corrupt EXIF block must cost the
 * photographer a few fields, never the import.
 */

export interface ExifFacts {
  readonly cameraMake?: string;
  readonly cameraModel?: string;
  readonly lens?: string;
  /** 1-8, the TIFF orientation. 1 is upright. */
  readonly orientation?: number;
  /** ISO 8601. See `capturedAtHasZone` before treating it as exact. */
  readonly capturedAt?: string;
  /**
   * False when the file recorded a wall-clock time and no offset from UTC.
   *
   * EXIF has carried a timezone only since 2.31, and most bodies still do not
   * write one. The time is then interpreted as UTC, because a timestamptz
   * column has to hold something -- and this flag is what lets the interface
   * say the camera did not record a timezone instead of implying it did.
   */
  readonly capturedAtHasZone?: boolean;
  readonly focalLengthMm?: number;
  readonly apertureF?: number;
  /** As a photographer reads it: "1/250" or "2.5 s". */
  readonly shutterSpeed?: string;
  readonly shutterSpeedSeconds?: number;
  readonly iso?: number;
  readonly gpsLatitude?: number;
  readonly gpsLongitude?: number;
  readonly gpsAltitudeM?: number;
  readonly width?: number;
  readonly height?: number;
  readonly colorProfile?: string;
  /** Recognised tags this product has no column for. Never filtered on. */
  readonly extra: Readonly<Record<string, string | number>>;
}

const EMPTY: ExifFacts = { extra: {} };

// TIFF field types, by their numeric code.
const BYTE = 1;
const ASCII = 2;
const SHORT = 3;
const LONG = 4;
const RATIONAL = 5;
const SLONG = 9;
const SRATIONAL = 10;

const TYPE_SIZES: Record<number, number> = {
  [BYTE]: 1,
  [ASCII]: 1,
  [SHORT]: 2,
  [LONG]: 4,
  [RATIONAL]: 8,
  7: 1,
  [SLONG]: 4,
  [SRATIONAL]: 8,
};

type Scalar = string | number;

interface Directory {
  readonly tags: Map<number, Scalar[]>;
}

/**
 * How far a directory chain may be followed.
 *
 * A crafted file can point a directory at itself. The visited set catches the
 * simple loop; this catches the long one.
 */
const MAX_IFDS = 12;

function readAscii(view: DataView, offset: number, length: number): string {
  const bytes: number[] = [];
  for (let index = 0; index < length; index += 1) {
    if (offset + index >= view.byteLength) break;
    const byte = view.getUint8(offset + index);
    // ASCII values are NUL-terminated, and trailing padding is common.
    if (byte === 0) break;
    bytes.push(byte);
  }
  return String.fromCharCode(...bytes).trim();
}

function readValues(
  view: DataView,
  entryOffset: number,
  tiffStart: number,
  little: boolean,
): Scalar[] | null {
  const type = view.getUint16(entryOffset + 2, little);
  const count = view.getUint32(entryOffset + 4, little);
  const unit = TYPE_SIZES[type];
  if (!unit || count === 0) return null;

  // A count large enough to overflow the file is a malformed directory, not a
  // very long string. Refuse it rather than walking off the end.
  const total = unit * count;
  if (total > 64 * 1024) return null;

  const inline = total <= 4;
  const valueOffset = inline
    ? entryOffset + 8
    : tiffStart + view.getUint32(entryOffset + 8, little);
  if (valueOffset < 0 || valueOffset + total > view.byteLength) return null;

  if (type === ASCII) return [readAscii(view, valueOffset, count)];

  const values: Scalar[] = [];
  for (let index = 0; index < count; index += 1) {
    const at = valueOffset + index * unit;
    switch (type) {
      case BYTE:
      case 7:
        values.push(view.getUint8(at));
        break;
      case SHORT:
        values.push(view.getUint16(at, little));
        break;
      case LONG:
        values.push(view.getUint32(at, little));
        break;
      case SLONG:
        values.push(view.getInt32(at, little));
        break;
      case RATIONAL: {
        const denominator = view.getUint32(at + 4, little);
        values.push(denominator === 0 ? 0 : view.getUint32(at, little) / denominator);
        break;
      }
      case SRATIONAL: {
        const denominator = view.getInt32(at + 4, little);
        values.push(denominator === 0 ? 0 : view.getInt32(at, little) / denominator);
        break;
      }
      default:
        return null;
    }
  }
  return values;
}

function readDirectory(
  view: DataView,
  offset: number,
  tiffStart: number,
  little: boolean,
): Directory | null {
  if (offset + 2 > view.byteLength) return null;
  const count = view.getUint16(offset, little);
  // A directory claiming thousands of entries is not one.
  if (count === 0 || count > 512) return null;

  const tags = new Map<number, Scalar[]>();
  for (let index = 0; index < count; index += 1) {
    const entryOffset = offset + 2 + index * 12;
    if (entryOffset + 12 > view.byteLength) break;
    const tag = view.getUint16(entryOffset, little);
    const values = readValues(view, entryOffset, tiffStart, little);
    if (values) tags.set(tag, values);
  }
  return { tags };
}

const first = (values: Scalar[] | undefined): Scalar | undefined => values?.[0];

const asNumber = (value: Scalar | undefined): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const asText = (value: Scalar | undefined): string | undefined => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.slice(0, 200) : undefined;
};

/**
 * "2026:08:19 18:47:03" plus an optional "+01:00" into an instant.
 *
 * Returns the flag as well as the value so the caller can be honest about
 * which of the two it got.
 */
export function parseExifDateTime(
  raw: string | undefined,
  offset?: string,
): { iso: string; hasZone: boolean } | null {
  if (!raw) return null;
  const match = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(raw.trim());
  if (!match) return null;

  const [, year, month, day, hour, minute, second] = match;
  const zone = /^[+-]\d{2}:\d{2}$/.test((offset ?? "").trim()) ? (offset as string).trim() : null;
  const candidate = `${year}-${month}-${day}T${hour}:${minute}:${second}${zone ?? "Z"}`;

  const date = new Date(candidate);
  if (Number.isNaN(date.getTime())) return null;
  // A camera clock set to 1970, or to 2153, is a clock nobody set. Recording it
  // would put a frame at the wrong end of the archive forever.
  const year4 = date.getUTCFullYear();
  if (year4 < 1990 || year4 > 2100) return null;

  return { iso: date.toISOString(), hasZone: zone !== null };
}

/** Degrees-minutes-seconds triple plus a hemisphere into a signed decimal. */
export function gpsToDecimal(
  parts: Scalar[] | undefined,
  ref: string | undefined,
): number | undefined {
  if (!parts || parts.length < 3) return undefined;
  const [degrees, minutes, seconds] = parts.map((part) => (typeof part === "number" ? part : NaN));
  if (![degrees, minutes, seconds].every(Number.isFinite)) return undefined;

  const magnitude = degrees + minutes / 60 + seconds / 3600;
  if (!Number.isFinite(magnitude) || magnitude > 180) return undefined;

  const negative = /^[SW]$/i.test((ref ?? "").trim());
  return Number((negative ? -magnitude : magnitude).toFixed(6));
}

/** An exposure time in seconds, written the way a photographer reads it. */
export function formatShutterSpeed(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "";
  if (seconds >= 1) return `${Number(seconds.toFixed(1))} s`;
  return `1/${Math.round(1 / seconds)}`;
}

// ---------------------------------------------------------------------------
// The ICC profile
// ---------------------------------------------------------------------------

function decodeUtf16Be(view: DataView, offset: number, byteLength: number): string {
  const units: number[] = [];
  for (let index = 0; index + 1 < byteLength; index += 2) {
    if (offset + index + 1 >= view.byteLength) break;
    units.push(view.getUint16(offset + index, false));
  }
  return String.fromCharCode(...units)
    .replace(/\0+$/, "")
    .trim();
}

/**
 * The human name of an ICC profile: "sRGB IEC61966-2.1", "Adobe RGB (1998)".
 *
 * Both encodings are handled because both are in the wild -- `desc` from v2
 * profiles, which most cameras still write, and `mluc` from v4.
 */
export function readIccDescription(profile: Uint8Array): string | undefined {
  if (profile.byteLength < 132) return undefined;
  const view = new DataView(profile.buffer, profile.byteOffset, profile.byteLength);

  const tagCount = view.getUint32(128, false);
  if (tagCount === 0 || tagCount > 200) return undefined;

  for (let index = 0; index < tagCount; index += 1) {
    const entry = 132 + index * 12;
    if (entry + 12 > view.byteLength) return undefined;

    const signature = readAscii(view, entry, 4);
    if (signature !== "desc") continue;

    const offset = view.getUint32(entry + 4, false);
    const size = view.getUint32(entry + 8, false);
    if (offset + size > view.byteLength || size < 12) return undefined;

    const type = readAscii(view, offset, 4);

    if (type === "desc") {
      const length = view.getUint32(offset + 8, false);
      return readAscii(view, offset + 12, Math.min(length, size - 12)) || undefined;
    }

    if (type === "mluc") {
      const records = view.getUint32(offset + 8, false);
      if (records === 0) return undefined;
      const length = view.getUint32(offset + 20, false);
      const stringOffset = view.getUint32(offset + 24, false);
      if (offset + stringOffset + length > view.byteLength) return undefined;
      return decodeUtf16Be(view, offset + stringOffset, length) || undefined;
    }

    return undefined;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Containers
// ---------------------------------------------------------------------------

interface Located {
  /** Where the TIFF header starts, and the base every offset is relative to. */
  readonly tiffStart: number;
  readonly icc?: Uint8Array;
}

const ICC_MARKER = "ICC_PROFILE\0";

/**
 * Walk a JPEG's segment chain for the two segments worth reading.
 *
 * Stops at the start of scan: everything after it is entropy-coded image data
 * with no segment structure to walk.
 */
function locateInJpeg(view: DataView, bytes: Uint8Array): Located | null {
  let offset = 2;
  let tiffStart: number | null = null;
  const iccChunks: Uint8Array[] = [];

  while (offset + 4 <= view.byteLength) {
    if (view.getUint8(offset) !== 0xff) break;
    const marker = view.getUint8(offset + 1);
    // Start of scan, or end of image.
    if (marker === 0xda || marker === 0xd9) break;

    const length = view.getUint16(offset + 2, false);
    if (length < 2 || offset + 2 + length > view.byteLength) break;
    const dataStart = offset + 4;

    if (marker === 0xe1 && readAscii(view, dataStart, 4) === "Exif" && tiffStart === null) {
      tiffStart = dataStart + 6;
    }

    if (marker === 0xe2 && length > 16) {
      const tag = String.fromCharCode(...bytes.subarray(dataStart, dataStart + ICC_MARKER.length));
      if (tag === ICC_MARKER) {
        // Sequence and total follow the marker; the chunks arrive in order in
        // every file this will meet, so they are simply concatenated.
        iccChunks.push(bytes.subarray(dataStart + ICC_MARKER.length + 2, offset + 2 + length));
      }
    }

    offset += 2 + length;
  }

  if (tiffStart === null && iccChunks.length === 0) return null;

  let icc: Uint8Array | undefined;
  if (iccChunks.length > 0) {
    const total = iccChunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
    icc = new Uint8Array(total);
    let at = 0;
    for (const chunk of iccChunks) {
      icc.set(chunk, at);
      at += chunk.byteLength;
    }
  }

  return { tiffStart: tiffStart ?? -1, icc };
}

/** The eXIf chunk, which carries a bare TIFF block with no "Exif\0\0" prefix. */
function locateInPng(view: DataView): Located | null {
  let offset = 8;
  while (offset + 8 <= view.byteLength) {
    const length = view.getUint32(offset, false);
    const type = readAscii(view, offset + 4, 4);
    if (type === "eXIf") return { tiffStart: offset + 8 };
    if (type === "IDAT" || type === "IEND") return null;
    if (length > view.byteLength) return null;
    offset += 12 + length;
  }
  return null;
}

function locate(bytes: Uint8Array, view: DataView): Located | null {
  if (view.byteLength < 12) return null;

  // JPEG
  if (view.getUint16(0, false) === 0xffd8) return locateInJpeg(view, bytes);

  // PNG
  if (view.getUint32(0, false) === 0x89504e47) return locateInPng(view);

  // Bare TIFF, which is what most RAW containers are.
  const order = view.getUint16(0, false);
  if (order === 0x4949 || order === 0x4d4d) return { tiffStart: 0 };

  return null;
}

// Tags, by directory.
const TAG = {
  imageWidth: 0x0100,
  imageHeight: 0x0101,
  make: 0x010f,
  model: 0x0110,
  orientation: 0x0112,
  software: 0x0131,
  dateTime: 0x0132,
  artist: 0x013b,
  exifPointer: 0x8769,
  gpsPointer: 0x8825,
  exposureTime: 0x829a,
  fNumber: 0x829d,
  iso: 0x8827,
  isoModern: 0x8833,
  dateTimeOriginal: 0x9003,
  offsetTimeOriginal: 0x9011,
  focalLength: 0x920a,
  colorSpace: 0xa001,
  pixelWidth: 0xa002,
  pixelHeight: 0xa003,
  focalLength35: 0xa405,
  lensMake: 0xa433,
  lensModel: 0xa434,
  bodySerial: 0xa431,
} as const;

const GPS = {
  latitudeRef: 1,
  latitude: 2,
  longitudeRef: 3,
  longitude: 4,
  altitudeRef: 5,
  altitude: 6,
} as const;

const COLOR_SPACES: Record<number, string> = {
  1: "sRGB",
  2: "Adobe RGB",
  65535: "Uncalibrated",
};

/**
 * Everything readable from a file's leading bytes.
 *
 * The caller is expected to hand over a prefix rather than a whole RAW: a TIFF
 * header points at IFD0 from byte four, and every camera this will meet writes
 * that directory near the front. A truncated buffer therefore yields the tags
 * that fit, which is the intended behaviour and not a degraded one.
 */
export function readExif(input: Uint8Array): ExifFacts {
  try {
    const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
    const located = locate(input, view);
    if (!located) return EMPTY;

    const extra: Record<string, string | number> = {};
    let colorProfile: string | undefined;

    if (located.icc) {
      colorProfile = readIccDescription(located.icc);
    }

    if (located.tiffStart < 0) {
      return colorProfile ? { colorProfile, extra } : EMPTY;
    }

    const tiffStart = located.tiffStart;
    if (tiffStart + 8 > view.byteLength) return colorProfile ? { colorProfile, extra } : EMPTY;

    const order = view.getUint16(tiffStart, false);
    if (order !== 0x4949 && order !== 0x4d4d) return colorProfile ? { colorProfile, extra } : EMPTY;
    const little = order === 0x4949;

    if (view.getUint16(tiffStart + 2, little) !== 42) {
      return colorProfile ? { colorProfile, extra } : EMPTY;
    }

    const ifd0Offset = view.getUint32(tiffStart + 4, little);
    const ifd0 = readDirectory(view, tiffStart + ifd0Offset, tiffStart, little);
    if (!ifd0) return colorProfile ? { colorProfile, extra } : EMPTY;

    const visited = new Set<number>([ifd0Offset]);
    const follow = (pointer: number | undefined): Directory | null => {
      if (pointer === undefined || pointer <= 0) return null;
      if (visited.has(pointer) || visited.size > MAX_IFDS) return null;
      visited.add(pointer);
      return readDirectory(view, tiffStart + pointer, tiffStart, little);
    };

    const exif = follow(asNumber(first(ifd0.tags.get(TAG.exifPointer))));
    const gps = follow(asNumber(first(ifd0.tags.get(TAG.gpsPointer))));

    const pick = (tag: number): Scalar[] | undefined => exif?.tags.get(tag) ?? ifd0.tags.get(tag);

    const captured =
      parseExifDateTime(
        asText(first(pick(TAG.dateTimeOriginal))),
        asText(first(pick(TAG.offsetTimeOriginal))),
      ) ?? parseExifDateTime(asText(first(ifd0.tags.get(TAG.dateTime))));

    const exposure = asNumber(first(pick(TAG.exposureTime)));
    const orientation = asNumber(first(ifd0.tags.get(TAG.orientation)));
    const colorSpace = asNumber(first(pick(TAG.colorSpace)));

    if (!colorProfile && colorSpace !== undefined) colorProfile = COLOR_SPACES[colorSpace];

    const software = asText(first(ifd0.tags.get(TAG.software)));
    if (software) extra.software = software;
    const artist = asText(first(ifd0.tags.get(TAG.artist)));
    if (artist) extra.artist = artist;
    const serial = asText(first(pick(TAG.bodySerial)));
    if (serial) extra.body_serial = serial;
    const focal35 = asNumber(first(pick(TAG.focalLength35)));
    if (focal35) extra.focal_length_35mm = focal35;

    const lensModel = asText(first(pick(TAG.lensModel)));
    const lensMake = asText(first(pick(TAG.lensMake)));
    const lens =
      lensModel && lensMake && !lensModel.toLowerCase().startsWith(lensMake.toLowerCase())
        ? `${lensMake} ${lensModel}`
        : (lensModel ?? lensMake);

    const width =
      asNumber(first(pick(TAG.pixelWidth))) ?? asNumber(first(ifd0.tags.get(TAG.imageWidth)));
    const height =
      asNumber(first(pick(TAG.pixelHeight))) ?? asNumber(first(ifd0.tags.get(TAG.imageHeight)));

    const facts: ExifFacts = {
      cameraMake: asText(first(ifd0.tags.get(TAG.make))),
      cameraModel: asText(first(ifd0.tags.get(TAG.model))),
      lens,
      orientation:
        orientation !== undefined && orientation >= 1 && orientation <= 8 ? orientation : undefined,
      capturedAt: captured?.iso,
      capturedAtHasZone: captured ? captured.hasZone : undefined,
      focalLengthMm: asNumber(first(pick(TAG.focalLength))),
      apertureF: asNumber(first(pick(TAG.fNumber))),
      shutterSpeed: exposure ? formatShutterSpeed(exposure) || undefined : undefined,
      shutterSpeedSeconds: exposure && exposure > 0 ? exposure : undefined,
      iso: asNumber(first(pick(TAG.iso))) ?? asNumber(first(pick(TAG.isoModern))),
      gpsLatitude: gps
        ? gpsToDecimal(gps.tags.get(GPS.latitude), asText(first(gps.tags.get(GPS.latitudeRef))))
        : undefined,
      gpsLongitude: gps
        ? gpsToDecimal(gps.tags.get(GPS.longitude), asText(first(gps.tags.get(GPS.longitudeRef))))
        : undefined,
      gpsAltitudeM: gps
        ? (() => {
            const altitude = asNumber(first(gps.tags.get(GPS.altitude)));
            if (altitude === undefined) return undefined;
            // Reference 1 means below sea level.
            const below = asNumber(first(gps.tags.get(GPS.altitudeRef))) === 1;
            return Number((below ? -altitude : altitude).toFixed(2));
          })()
        : undefined,
      width,
      height,
      colorProfile,
      extra,
    };

    // Drop the keys that came back undefined so a caller can spread this over
    // existing values without blanking them.
    return Object.fromEntries(
      Object.entries(facts).filter(([, value]) => value !== undefined),
    ) as ExifFacts;
  } catch {
    // A malformed file costs its tags, never the import.
    return EMPTY;
  }
}

/**
 * How much of a file is worth fetching to read its tags.
 *
 * IFD0 sits near the front of every TIFF, and a JPEG's APP1 is the second
 * segment. A quarter of a megabyte covers both with room for a large ICC
 * profile, and keeps a 60 MB RAW from crossing the network to answer a question
 * about its first few hundred bytes.
 */
export const EXIF_PREFIX_BYTES = 262_144;
