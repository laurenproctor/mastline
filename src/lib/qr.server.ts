import QRCode from "qrcode";

/**
 * A QR code, as geometry rather than as an image.
 *
 * Enrolment needs a code the camera in an authenticator app can read, and the
 * secret it carries must not leave this server on its way there. So nothing is
 * fetched from an image service: the matrix is computed here and handed to the
 * screen as a single SVG path, which draws crisply at any size and takes its
 * colour from the surrounding text.
 *
 * Separated into a `.server` module because `qrcode` is a Node library and the
 * panel that shows the result is a client component.
 */

export interface QrCode {
  /** Modules per side, including the quiet zone the viewBox does not add. */
  readonly size: number;
  /** An SVG path covering every dark module, in a 0 0 size size viewBox. */
  readonly path: string;
}

/**
 * Encode text as a QR code.
 *
 * Runs of adjacent dark modules become one rectangle rather than one per
 * module. An otpauth URI is around 25 modules a side, so this is the difference
 * between a path of a few hundred characters and one of several thousand
 * crossing the server action boundary on every enrolment.
 */
export async function qrCode(text: string): Promise<QrCode> {
  // Level M tolerates about 15% damage, which is the usual choice for a code
  // read off a screen rather than off paper that has been folded in a bag.
  const encoded = QRCode.create(text, { errorCorrectionLevel: "M" });
  const { size, data } = encoded.modules;

  const parts: string[] = [];
  for (let y = 0; y < size; y += 1) {
    let x = 0;
    while (x < size) {
      if (!data[y * size + x]) {
        x += 1;
        continue;
      }
      const start = x;
      while (x < size && data[y * size + x]) x += 1;
      parts.push(`M${start} ${y}h${x - start}v1h-${x - start}z`);
    }
  }

  return { size, path: parts.join("") };
}
