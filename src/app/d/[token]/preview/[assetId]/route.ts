import { NextResponse } from "next/server";
import { isDeliveryToken } from "@/lib/delivery";
import { watermarkPreview } from "@/lib/images/watermark.server";
import { isRecordId } from "@/lib/validation";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * A preview, marked for the desk it was sent to.
 *
 * The buyer page used to hand out a signed URL straight to the stored preview,
 * which meant the clean file was one right-click away. It goes through here now,
 * so the only version a recipient can reach is the marked one.
 *
 * It is rendered from the exact object the approval froze in the submission's
 * snapshot -- scaled and marked here -- never from whichever preview or
 * delivery derivative is preferred today. `delivery_preview()` returns nothing
 * for a frame outside this submission, or whose approved object cannot be
 * rendered as an image, and nothing is substituted.
 *
 * Marked once per delivery and kept: the mark names the recipient, so it cannot
 * be shared between links, but a desk refreshing the page should not re-render
 * it every time. The cached copy lives beside the original in the private
 * bucket and is served through here as well -- never linked to directly.
 */
export const dynamic = "force-dynamic";

/** Long enough that a scroll costs nothing; short enough to stay a preview. */
const CACHE_SECONDS = 900;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string; assetId: string }> },
) {
  const { token, assetId } = await params;
  if (!isDeliveryToken(token) || !isRecordId(assetId)) {
    return new NextResponse("Not found", { status: 404 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("delivery_preview", {
    delivery_token: token,
    target_asset: assetId,
  });

  const row = (data ?? [])[0];
  // Unknown, withdrawn, expired, or not in this package: the same answer for
  // all of them, as everywhere else on this surface.
  if (error || !row) return new NextResponse("Not found", { status: 404 });

  const admin = createAdminClient();
  const markedKey = `watermarked/${token.slice(0, 24)}/${assetId}.jpg`;

  const cached = await admin.storage.from("derivatives").download(markedKey);
  if (cached.data) {
    return new NextResponse(await cached.data.arrayBuffer(), {
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": `private, max-age=${CACHE_SECONDS}`,
      },
    });
  }

  /*
   * The exact object the approval froze. If it cannot be read, nothing else is
   * read in its place: the recipient sees the page's "no preview" state and
   * the failure is recorded for the operator, without the location.
   */
  const source = await admin.storage.from(row.storage_bucket).download(row.object_key);
  if (source.error || !source.data) {
    console.error(`delivery preview: the approved object for frame ${assetId} could not be read`);
    return new NextResponse("Not found", { status: 404 });
  }

  let marked: { body: Buffer; contentType: string };
  try {
    marked = await watermarkPreview(Buffer.from(await source.data.arrayBuffer()), {
      recipient: row.recipient_label ?? undefined,
      credit: row.credit_line ?? undefined,
      sentOn: row.sent_on
        ? new Date(row.sent_on).toLocaleDateString("en-GB", {
            day: "numeric",
            month: "short",
            year: "numeric",
          })
        : undefined,
    });
  } catch {
    // A preview that cannot be marked is not served unmarked. The page shows
    // its "no preview" state instead, which is the honest outcome.
    console.error(`delivery preview: the approved object for frame ${assetId} could not be marked`);
    return new NextResponse("Not found", { status: 404 });
  }

  // Best effort: failing to cache costs a re-render, not a response.
  await admin.storage
    .from("derivatives")
    .upload(markedKey, marked.body, { contentType: marked.contentType, upsert: true });

  return new NextResponse(new Uint8Array(marked.body), {
    headers: {
      "Content-Type": marked.contentType,
      "Cache-Control": `private, max-age=${CACHE_SECONDS}`,
    },
  });
}
