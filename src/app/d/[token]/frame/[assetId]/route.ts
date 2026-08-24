import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { callerAddress, callerAgent, isDeliveryToken } from "@/lib/delivery";
import { isRecordId } from "@/lib/validation";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * Taking a copy.
 *
 * The record is written before the file is handed over, by the same function
 * that decides whether to hand it over at all -- so there is no path that
 * downloads without logging. A refusal is recorded too, which is how an
 * expired link being tried three times is visible rather than silent.
 *
 * The response is a redirect to a short-lived signed URL rather than the bytes,
 * so a large frame does not pass through the application, and the URL that does
 * reach the recipient stops working shortly afterwards.
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
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("record_delivery_download", {
    delivery_token: token,
    target_asset: assetId,
    caller_ip: callerAddress(requestHeaders),
    caller_agent: callerAgent(requestHeaders),
  });

  if (error) return new NextResponse("Not found", { status: 404 });

  const row = (data ?? [])[0];
  if (!row) {
    // Unknown, withdrawn, expired, or not part of this package: the same answer
    // for all of them.
    return new NextResponse("This link is not open", { status: 404 });
  }

  // The function above is the authorisation: it checked the token, the expiry,
  // the withdrawal, and that this frame belongs to this package, and it wrote
  // the record. Signing is the trusted step that follows, so it runs with the
  // service role -- the caller is anonymous and has, correctly, no rights of
  // their own on a private bucket.
  const { data: signed, error: signError } = await createAdminClient()
    .storage.from(row.storage_bucket)
    .createSignedUrl(row.object_key, 300, { download: row.filename });

  if (signError || !signed) return new NextResponse("Not found", { status: 404 });
  return NextResponse.redirect(signed.signedUrl, { status: 303 });
}
