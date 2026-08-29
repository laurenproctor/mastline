import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { callerAddress, callerAgent, isDeliveryToken } from "@/lib/delivery";
import { serveDeliveryDownload } from "@/lib/delivery-download";
import { isRecordId } from "@/lib/validation";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Taking a copy of the exact frame that was approved.
 *
 * Four steps, each gating the next -- see src/lib/delivery-download.ts:
 *
 *   1. `authorize_delivery_download` checks the token, the expiry, the
 *      withdrawal, the acceptance, and that this frame is in the submission's
 *      approved snapshot. It records any refusal and returns the frozen object.
 *   2. The frozen object is signed, with the service role: the caller is
 *      anonymous and has, correctly, no rights of their own on a private bucket.
 *   3. `record_delivery_download` re-validates and writes the `downloaded`
 *      event. A record that could not be written releases no file.
 *   4. The recipient is redirected to the short-lived signed URL.
 *
 * Every failure is the same neutral answer. Nothing in a response, a log line,
 * or an error names a bucket, an object key, or the token.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string; assetId: string }> },
) {
  const { token, assetId } = await params;
  if (!isDeliveryToken(token) || !isRecordId(assetId)) {
    return new NextResponse("Not found", { status: 404 });
  }

  const requestHeaders = await headers();
  /*
   * Both database calls run with the service role: authorisation answers with
   * a private object's location, and recording writes commercial evidence, so
   * neither is executable by the anonymous role a browser holds. The token is
   * still the credential -- the functions check it, the expiry, the
   * withdrawal, the acceptance, and the snapshot before answering -- and this
   * route is the only caller.
   */
  const admin = createAdminClient();
  const caller = {
    delivery_token: token,
    target_asset: assetId,
    caller_ip: callerAddress(requestHeaders),
    caller_agent: callerAgent(requestHeaders),
  };

  const outcome = await serveDeliveryDownload({
    authorize: async () => {
      const { data, error } = await admin.rpc("authorize_delivery_download", caller);
      if (error) return null;
      const row = (data ?? [])[0] as
        { object_key: string; storage_bucket: string; filename: string } | undefined;
      if (!row) return null;
      return {
        objectKey: row.object_key,
        storageBucket: row.storage_bucket,
        filename: row.filename,
      };
    },
    sign: async (target) => {
      const { data, error } = await admin.storage
        .from(target.storageBucket)
        .createSignedUrl(target.objectKey, 300, { download: target.filename });
      if (error || !data) return null;
      return { url: data.signedUrl };
    },
    record: async () => {
      const { data, error } = await admin.rpc("record_delivery_download", caller);
      if (error) return false;
      return (data ?? []).length > 0;
    },
  });

  if (outcome.kind === "refused") {
    // Unknown, withdrawn, expired, unaccepted, or not part of this submission:
    // the same answer for all of them.
    return new NextResponse("This link is not open", { status: 404 });
  }

  if (outcome.kind === "unavailable") {
    // Authorised, but the approved object could not be signed or the download
    // could not be recorded. Nothing is substituted and nothing is released.
    // Logged for the operator without the object's location.
    console.error(
      `delivery download: frame ${assetId} was authorised but not released (${outcome.reason})`,
    );
    return new NextResponse("Not found", { status: 404 });
  }

  return NextResponse.redirect(outcome.url, { status: 303 });
}
