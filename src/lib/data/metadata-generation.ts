import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CONTENT_CATEGORIES, QUALITY_ESTIMATES, SENSITIVITIES } from "../asset-metadata";
import type { Id } from "../domain";
import { EXIF_PREFIX_BYTES, type ExifFacts, readExif } from "../exif";
import {
  GENERATION_SYSTEM_PROMPT,
  type GeneratedMetadata,
  type GenerationContext,
  MAX_KEYWORDS,
  MAX_LIST_ITEMS,
  buildGenerationPrompt,
  describeGenerationBasis,
  normaliseGeneration,
  supportsEffort,
} from "../metadata-generation";
import { getShoot } from "./shoots";

/**
 * Reading a frame: the bytes for the tags, and the picture for the words.
 *
 * Two separate readings of the same photograph, deliberately kept apart.
 *
 *   TECHNICAL comes from the file's own EXIF. It is not a guess and never
 *   becomes one, so it is extracted even when generation is unavailable or
 *   fails -- a workspace with no model key still gets its capture times,
 *   cameras, and coordinates.
 *
 *   EDITORIAL comes from a vision model reading the preview derivative. It is
 *   always a proposal, always attributed, and never usable until a person
 *   confirms it.
 *
 * Nothing here writes to the database. This module returns what it read; the
 * job runner decides what may be stored, and the merge rules in
 * src/lib/asset-metadata.ts decide what may be overwritten.
 *
 * Every path is scoped by organization_id and runs through a caller-supplied
 * Supabase client, so storage policies and row level security decide what may
 * be read before anything crosses the network.
 */

/**
 * Haiku 4.5: the cheapest model that can see, and this is not a hard seeing
 * task. Describing what is visible in one frame is exactly the kind of short,
 * well-specified work the small model is for, and the cost difference decides
 * whether the feature can be offered on every frame or only on a chosen few.
 *
 * Falls back to the caption writer's own override so a deployment that pinned
 * one model for suggestions does not silently run two. Changing it needs a
 * redeploy, not just a restart: the value is read on the server at request
 * time, but Vercel only hands a new environment to a new deployment.
 */
const MODEL =
  process.env.MASTLINE_METADATA_MODEL ??
  process.env.MASTLINE_SUGGESTION_MODEL ??
  "claude-haiku-4-5";

/**
 * Which Anthropic workspace this deployment's requests act in.
 *
 * Same rule as src/lib/data/metadata-suggestions.ts, for the same key: an
 * identity-backed key can act in several workspaces and the API refuses to
 * guess. Left unset, no header is sent, which is correct for a scoped key.
 */
const WORKSPACE_ID = process.env.ANTHROPIC_WORKSPACE_ID?.trim();

/**
 * A generation is a short structured draft, not an essay. The cap is generous
 * enough for the tool call plus whatever thinking the model does on the way to
 * it, and small enough that a runaway response cannot become an expensive one.
 */
const MAX_TOKENS = 4000;

/** Nullable in the schema, because "I could not tell" has to be expressible. */
const nullableString = (description: string) => ({
  type: ["string", "null"] as const,
  description,
});

/*
 * List caps are stated in the descriptions rather than expressed as
 * `maxItems`, which `strict: true` rejects outright -- "For 'array' type,
 * property 'maxItems' is not supported" -- taking every generation with it.
 * The description was never the thing enforcing the limit anyway:
 * normaliseGeneration slices on the way in, because a cap that lives only in
 * a schema the model is asked to honour is not a cap.
 */
const GENERATION_TOOL: Anthropic.Tool = {
  name: "record_metadata",
  description:
    "Record the drafted metadata for this frame. Always call this exactly once. Use null for anything you cannot settle.",
  strict: true,
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      headline: nullableString("A short line a picture desk can scan. No names of people."),
      caption: nullableString(
        "One or two sentences describing only what is visible. No names you were not given, no inferred events.",
      ),
      alt_text: nullableString(
        "One literal sentence for a reader who cannot see the image. No names.",
      ),
      event: nullableString("The event or context, ONLY if the photographer recorded one."),
      venue: nullableString(
        "The venue, only if named in the frame or recorded by the photographer.",
      ),
      city: nullableString("City, only if recorded by the photographer or unambiguously readable."),
      region: nullableString("State or region, under the same rule as city."),
      country: nullableString("Country, under the same rule as city."),
      scene: nullableString("The activity in a few words, e.g. 'walking to a car'."),
      objects: {
        type: "array",
        items: { type: "string" },
        description: `Objects plainly visible in the frame, at most ${MAX_LIST_ITEMS}. Empty if none stand out.`,
      },
      clothing: {
        type: "array",
        items: { type: "string" },
        description: `Clothing and accessories visible on people in frame, at most ${MAX_LIST_ITEMS}.`,
      },
      brands: {
        type: "array",
        items: { type: "string" },
        description: `Brands or products you can actually read or unmistakably see, at most ${MAX_LIST_ITEMS}. Empty if you are inferring.`,
      },
      keywords: {
        type: "array",
        items: { type: "string" },
        description: `Lowercase search terms, at most ${MAX_KEYWORDS}. No names of people.`,
      },
      category: {
        type: ["string", "null"],
        enum: [...CONTENT_CATEGORIES, null],
        description: "The kind of picture this is.",
      },
      quality: {
        type: ["string", "null"],
        enum: [...QUALITY_ESTIMATES, null],
        description: "How usable the frame looks technically.",
      },
      sensitivity: {
        type: "string",
        enum: [...SENSITIVITIES],
        description:
          "'review' if a desk should look before publishing; 'sensitive' if that is clearly the case; otherwise 'none'.",
      },
      uncertainty_note: nullableString("What you could not settle, in one short sentence."),
      basis: {
        type: "string",
        description: "One short sentence on what this was drafted from.",
      },
      confidence: {
        type: "number",
        description:
          "0 to 1. Low when the frame is dark, blurred, or ambiguous; high when the content is unmistakable.",
      },
      field_confidence: {
        type: "object",
        additionalProperties: false,
        description: "0 to 1 for the fields most easily got wrong.",
        properties: {
          caption: { type: "number" },
          location: { type: "number" },
          brands: { type: "number" },
          category: { type: "number" },
        },
        required: ["caption", "location", "brands", "category"],
      },
    },
    required: [
      "headline",
      "caption",
      "alt_text",
      "event",
      "venue",
      "city",
      "region",
      "country",
      "scene",
      "objects",
      "clothing",
      "brands",
      "keywords",
      "category",
      "quality",
      "sensitivity",
      "uncertainty_note",
      "basis",
      "confidence",
      "field_confidence",
    ],
  },
};

/** True when the deployment has been given an API key to call with. */
export function generationIsConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

/**
 * Why a generation did not produce anything.
 *
 * A code rather than a message so the caller can decide whether to retry, and
 * so the sentence a photographer reads is written here rather than echoed from
 * a provider. A provider's own error text can carry a request id, a key prefix,
 * or the prompt back again, and none of that belongs on a screen or in a column.
 */
export type GenerationFailureCode =
  | "not_configured"
  | "asset_unreadable"
  | "no_frame"
  | "refused"
  | "rate_limited"
  | "auth_rejected"
  | "provider_error"
  | "empty_response"
  | "unknown";

export interface GenerationFailure {
  readonly code: GenerationFailureCode;
  readonly detail: string;
  /** Whether another attempt could plausibly succeed. */
  readonly retryable: boolean;
}

const FAILURES: Record<GenerationFailureCode, Omit<GenerationFailure, "code">> = {
  not_configured: {
    detail: "Metadata generation is not configured for this deployment.",
    retryable: false,
  },
  asset_unreadable: {
    detail: "That photograph could not be read. It may have been removed.",
    retryable: false,
  },
  no_frame: {
    detail:
      "There is no readable preview for this file, so there is nothing to describe. Caption it by hand.",
    retryable: false,
  },
  refused: {
    detail: "The model declined to describe this frame. Caption it by hand.",
    retryable: false,
  },
  rate_limited: {
    detail: "Too many frames at once. This will be tried again shortly.",
    retryable: true,
  },
  auth_rejected: {
    detail: "The generation service rejected this deployment's key.",
    retryable: false,
  },
  provider_error: { detail: "The generation service was unavailable.", retryable: true },
  empty_response: {
    detail: "Nothing usable came back. Caption it by hand or try again.",
    retryable: true,
  },
  unknown: { detail: "The metadata could not be generated.", retryable: true },
};

export function failure(code: GenerationFailureCode): GenerationFailure {
  return { code, ...FAILURES[code] };
}

export type GenerationOutcome =
  | {
      readonly ok: true;
      readonly generated: GeneratedMetadata;
      readonly model: string;
      readonly modelVersion?: string;
    }
  | { readonly ok: false; readonly failure: GenerationFailure };

// ---------------------------------------------------------------------------
// Technical extraction
// ---------------------------------------------------------------------------

export interface OriginalFacts {
  readonly objectKey: string;
  readonly bucket: string;
  readonly mimeType: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly width?: number;
  readonly height?: number;
  readonly originalFilename?: string;
}

/** The original version row, which is where the container facts already live. */
export async function readOriginalFacts(
  supabase: SupabaseClient,
  organizationId: Id,
  assetId: Id,
): Promise<OriginalFacts | null> {
  const { data } = await supabase
    .from("asset_versions")
    .select(
      "storage_bucket, object_key, mime_type, bytes, sha256, width, height, technical_metadata",
    )
    .eq("organization_id", organizationId)
    .eq("asset_id", assetId)
    .eq("version_kind", "original")
    .maybeSingle();

  if (!data) return null;

  const technical = (data.technical_metadata ?? {}) as Record<string, unknown>;

  return {
    objectKey: String(data.object_key),
    bucket: String(data.storage_bucket),
    mimeType: String(data.mime_type),
    bytes: Number(data.bytes),
    sha256: String(data.sha256),
    width: (data.width as number | null) ?? undefined,
    height: (data.height as number | null) ?? undefined,
    originalFilename:
      typeof technical.original_filename === "string" ? technical.original_filename : undefined,
  };
}

/**
 * The tags in an original, read from its first quarter-megabyte.
 *
 * A signed URL plus a Range request rather than `storage.download`, because the
 * client has no range option and a 60 MB RAW crossing the network to answer a
 * question about its header is not a thing to do once per frame on a card dump.
 * A storage backend that ignores the range answers 200 with the whole body; the
 * stream is then cut off at the same limit rather than buffered, so the wrong
 * answer costs bandwidth and never memory.
 */
export async function readExifFromOriginal(
  supabase: SupabaseClient,
  original: OriginalFacts,
): Promise<ExifFacts | null> {
  const { data, error } = await supabase.storage
    .from(original.bucket)
    .createSignedUrl(original.objectKey, 120);

  if (error || !data?.signedUrl) return null;

  try {
    const response = await fetch(data.signedUrl, {
      headers: { Range: `bytes=0-${EXIF_PREFIX_BYTES - 1}` },
    });
    if (!response.ok && response.status !== 206) return null;

    const body = response.body;
    if (!body) return null;

    const chunks: Uint8Array[] = [];
    let total = 0;
    const reader = body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.byteLength;
      if (total >= EXIF_PREFIX_BYTES) {
        await reader.cancel();
        break;
      }
    }

    const prefix = new Uint8Array(Math.min(total, EXIF_PREFIX_BYTES));
    let at = 0;
    for (const chunk of chunks) {
      if (at >= prefix.byteLength) break;
      const slice = chunk.subarray(0, prefix.byteLength - at);
      prefix.set(slice, at);
      at += slice.byteLength;
    }

    return readExif(prefix);
  } catch {
    // A storage hiccup costs the tags, not the job. The editorial half still
    // runs, and the technical half is retried on the next generation.
    return null;
  }
}

// ---------------------------------------------------------------------------
// Editorial generation
// ---------------------------------------------------------------------------

interface FrameBytes {
  readonly base64: string;
  readonly mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif";
  readonly fromVideo: boolean;
}

const SENDABLE: Record<string, FrameBytes["mediaType"]> = {
  "image/jpeg": "image/jpeg",
  "image/png": "image/png",
  "image/webp": "image/webp",
  "image/gif": "image/gif",
};

/**
 * The frame to send, preferring the derivative that already exists.
 *
 * The preview is already the right size, it is already the frame the contact
 * sheet shows, and for a video clip it is the poster frame -- which is the only
 * way a clip can be described by an image model at all. Falling back to the
 * original covers an asset imported before previews existed. A RAW or a video
 * with no poster returns null: there is nothing an image model can read, and
 * inventing a caption from a filename would be worse than an empty field.
 */
async function readFrame(
  supabase: SupabaseClient,
  organizationId: Id,
  assetId: Id,
): Promise<FrameBytes | null> {
  const { data: versions } = await supabase
    .from("asset_versions")
    .select("version_kind, storage_bucket, object_key, mime_type")
    .eq("organization_id", organizationId)
    .eq("asset_id", assetId);

  const rows = versions ?? [];
  const preview = rows.find((row) => row.version_kind === "preview");
  const original = rows.find((row) => row.version_kind === "original");

  const originalIsVideo = String(original?.mime_type ?? "").startsWith("video/");

  const chosen =
    preview ?? (original && SENDABLE[String(original.mime_type)] ? original : undefined);
  if (!chosen) return null;

  const mediaType = SENDABLE[String(chosen.mime_type)] ?? "image/jpeg";

  const { data, error } = await supabase.storage
    .from(String(chosen.storage_bucket))
    .download(String(chosen.object_key));

  if (error || !data) return null;

  const buffer = Buffer.from(await data.arrayBuffer());
  return {
    base64: buffer.toString("base64"),
    mediaType,
    fromVideo: originalIsVideo,
  };
}

/**
 * Draft editorial metadata for one photograph.
 *
 * Returns a coded failure rather than throwing for everything that is expected
 * -- no key configured, nothing to read, the model declined, the service was
 * busy -- because none of those are bugs, all of them need to be readable in
 * the panel, and the job runner needs to know which of them are worth retrying.
 */
export async function generateMetadataForAsset(input: {
  organizationId: Id;
  assetId: Id;
  client: SupabaseClient;
}): Promise<GenerationOutcome> {
  if (!generationIsConfigured()) return { ok: false, failure: failure("not_configured") };

  const { client: supabase, organizationId, assetId } = input;

  const { data: asset, error: assetError } = await supabase
    .from("assets")
    .select("id, shoot_id, status, captured_at, location_name, asset_kind, subjects")
    .eq("organization_id", organizationId)
    .eq("id", assetId)
    .maybeSingle();

  if (assetError || !asset || asset.status === "tombstoned") {
    return { ok: false, failure: failure("asset_unreadable") };
  }

  const frame = await readFrame(supabase, organizationId, assetId);
  if (!frame) return { ok: false, failure: failure("no_frame") };

  const shoot = asset.shoot_id
    ? await getShoot(organizationId, asset.shoot_id as string, supabase)
    : null;

  const context: GenerationContext = {
    shootTitle: shoot?.title,
    storyAngle: shoot?.storyAngle,
    // The frame's own location wins over the shoot's: it may have been
    // corrected here after being inherited.
    locationName: (asset.location_name as string | null) ?? shoot?.locationName,
    capturedAt: (asset.captured_at as string | null) ?? undefined,
    knownSubjects: Array.isArray(asset.subjects) ? (asset.subjects as string[]) : [],
    isVideo: frame.fromVideo || asset.asset_kind === "video",
  };

  try {
    const anthropic = new Anthropic(
      WORKSPACE_ID ? { defaultHeaders: { "anthropic-workspace-id": WORKSPACE_ID } } : {},
    );

    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      // Low effort where the model takes it at all: this is a short, well
      // specified description task, and the photographer is standing on a
      // pavement waiting for it.
      ...(supportsEffort(MODEL) ? { output_config: { effort: "low" as const } } : {}),
      system: GENERATION_SYSTEM_PROMPT,
      tools: [GENERATION_TOOL],
      tool_choice: { type: "tool", name: GENERATION_TOOL.name },
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: frame.mediaType, data: frame.base64 },
            },
            { type: "text", text: buildGenerationPrompt(context) },
          ],
        },
      ],
    });

    if (response.stop_reason === "refusal") {
      return { ok: false, failure: failure("refused") };
    }

    const call = response.content.find(
      (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
    );
    const generated = normaliseGeneration(call?.input, describeGenerationBasis(context));

    if (!generated) return { ok: false, failure: failure("empty_response") };

    return { ok: true, generated, model: MODEL, modelVersion: response.model };
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) {
      return { ok: false, failure: failure("rate_limited") };
    }
    if (error instanceof Anthropic.AuthenticationError) {
      return { ok: false, failure: failure("auth_rejected") };
    }
    if (error instanceof Anthropic.APIError) {
      // The status is useful and safe. The body is not, and is not recorded.
      return {
        ok: false,
        failure: {
          ...failure("provider_error"),
          detail: `The generation service returned ${error.status}.`,
          retryable: error.status === undefined || error.status >= 500 || error.status === 429,
        },
      };
    }
    return { ok: false, failure: failure("unknown") };
  }
}
