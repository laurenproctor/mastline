import { NextResponse } from "next/server";
import { drainMetadataJobs, generationIsAvailable } from "@/lib/data/metadata-jobs";

/**
 * The sweep.
 *
 * Metadata jobs are normally drained by the request that queued them, on the
 * tail of the same invocation. Two things escape that:
 *
 *   - a batch larger than one drain, where a card of two hundred frames leaves
 *     work behind that no later request happens to pick up
 *   - a worker killed mid-frame, whose lease expires and whose job then needs
 *     somebody to claim it again
 *
 * This endpoint is that somebody. Point a scheduler at it -- Vercel Cron, or
 * anything that can send a bearer token -- and the queue drains whether or not
 * anyone is using the application. Without a scheduler nothing is lost; the
 * work is simply picked up by the next drain, which is the trade-off recorded
 * in src/lib/data/metadata-jobs.ts.
 *
 * AUTHORIZATION
 *
 * There is no session here. A bearer secret is required, and with none
 * configured the endpoint refuses every request rather than running unbounded
 * model calls for anyone who finds the URL. That is the same posture as the
 * delivery webhook, and for the same reason: an unauthenticated machine surface
 * fails closed or it is a liability.
 *
 * `CRON_SECRET` is read as a fallback because that is the variable Vercel Cron
 * sends by default, and requiring a second name for the same value would be a
 * configuration step with nothing behind it.
 */

function secret(): string | null {
  return process.env.METADATA_WORKER_SECRET ?? process.env.CRON_SECRET ?? null;
}

/**
 * Constant-time comparison.
 *
 * A shared secret compared with `===` leaks its prefix through timing. The cost
 * of doing it properly here is a few microseconds.
 */
function matches(presented: string, expected: string): boolean {
  if (presented.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < presented.length; index += 1) {
    difference |= presented.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  return difference === 0;
}

async function drain(request: Request): Promise<NextResponse> {
  const expected = secret();
  if (!expected) {
    return NextResponse.json({ error: "The metadata worker is not configured." }, { status: 503 });
  }

  const header = request.headers.get("authorization") ?? "";
  const presented = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!presented || !matches(presented, expected)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  if (!generationIsAvailable()) {
    return NextResponse.json(
      { error: "Metadata generation is not configured for this deployment." },
      { status: 503 },
    );
  }

  // A sweep may take more than one drain's worth, but not without limit: this
  // still has to finish inside one serverless invocation, and a job it does not
  // reach is picked up by the next sweep rather than lost.
  const report = await drainMetadataJobs(10);

  return NextResponse.json(report, {
    status: 200,
    headers: { "cache-control": "no-store" },
  });
}

/** GET, because that is what a scheduler sends. */
export async function GET(request: Request) {
  return drain(request);
}

/** POST, for anything that would rather not put work behind a GET. */
export async function POST(request: Request) {
  return drain(request);
}
