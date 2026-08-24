import sharp from "sharp";
import { type WatermarkText, watermarkSvg } from "../watermark";

/**
 * Burning the mark into a preview.
 *
 * Separated from the overlay itself so that the wording and geometry stay
 * testable without an image library, and so nothing that imports the text
 * helpers drags sharp into a bundle that cannot hold it.
 *
 * The output is always JPEG: this is a preview for judging a picture, not an
 * archival copy, and a predictable type keeps the route simple.
 */
/**
 * A preview is a preview.
 *
 * The source may be a delivery derivative when no preview was generated, so it
 * is scaled down here rather than trusted to be small. Falling back must not
 * quietly mean handing over the full file.
 */
const PREVIEW_MAX_EDGE = 1400;

export async function watermarkPreview(
  input: Buffer,
  text: WatermarkText,
): Promise<{ body: Buffer; contentType: string }> {
  const scaled = await sharp(input, { failOn: "none" })
    // Orientation is applied first: a mark burned onto an unrotated frame would
    // sit sideways once a viewer honours the EXIF.
    .rotate()
    .resize({
      width: PREVIEW_MAX_EDGE,
      height: PREVIEW_MAX_EDGE,
      fit: "inside",
      withoutEnlargement: true,
    })
    .toBuffer();

  const image = sharp(scaled);
  const metadata = await image.metadata();

  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  if (!width || !height) {
    throw new Error("That preview could not be read, so it was not marked.");
  }

  const overlay = Buffer.from(watermarkSvg({ width, height, text }));
  const body = await image
    .composite([{ input: overlay, top: 0, left: 0 }])
    .jpeg({ quality: 82, progressive: true })
    .toBuffer();

  return { body, contentType: "image/jpeg" };
}
