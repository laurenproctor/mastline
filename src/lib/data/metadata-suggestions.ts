import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Id } from "../domain";
import {
  type MetadataSuggestion,
  type SuggestionContext,
  MAX_KEYWORDS,
  SUGGESTION_SYSTEM_PROMPT,
  buildSuggestionPrompt,
  describeBasis,
  normaliseSuggestion,
} from "../metadata-suggestions";
import { createClient } from "../supabase/server";
import { getShoot } from "./shoots";

/**
 * Ask a vision model to draft caption metadata for one frame.
 *
 * The bytes never leave the server unsigned: the browser sends an asset id, and
 * this reads the workspace's own preview derivative through the caller's
 * Supabase client, so row level security decides what may be read before
 * anything is sent anywhere.
 *
 * The frame that goes to the model is the preview derivative, not the original.
 * It is already the right size, it is already the frame the contact sheet
 * shows, and for a video clip it is the poster frame -- which is the only way a
 * clip can be described by an image model at all. A RAW file with no browser
 * preview has nothing to send, and says so rather than guessing from a filename.
 */

/** Overridable so a workspace can be moved to a cheaper model without a deploy. */
const MODEL = process.env.MASTLINE_SUGGESTION_MODEL ?? "claude-opus-5";

/**
 * A suggestion is a short, structured draft, not an essay. The cap is generous
 * enough for adaptive thinking plus the tool call, and small enough that a
 * runaway response cannot become an expensive one.
 */
const MAX_TOKENS = 4000;

const SUGGESTION_TOOL: Anthropic.Tool = {
  name: "record_suggestion",
  description: "Record the drafted caption metadata for this frame. Always call this exactly once.",
  strict: true,
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      headline: {
        type: "string",
        description: "A short line a picture desk can scan. No names of people.",
      },
      caption: {
        type: "string",
        description:
          "One or two sentences describing only what is visible. No names of people, no inferred events.",
      },
      keywords: {
        type: "array",
        maxItems: MAX_KEYWORDS,
        items: { type: "string" },
        description: "Lowercase search terms. No names of people.",
      },
      basis: {
        type: "string",
        description: "One short sentence on what this was drafted from.",
      },
      confidence: {
        type: "number",
        description:
          "0 to 1. Low when the frame is dark, blurred, or ambiguous; high when the content is unmistakable.",
      },
    },
    required: ["headline", "caption", "keywords", "basis", "confidence"],
  },
};

export interface SuggestionOutcome {
  readonly ok: boolean;
  readonly suggestion?: MetadataSuggestion;
  readonly error?: string;
}

/** True when the workspace has been given an API key to call with. */
export function suggestionsAreConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

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
 * Falling back to the original covers an asset imported before previews were
 * generated. A RAW or a video with no poster returns null: there is nothing an
 * image model can read, and inventing a caption from a filename would be worse
 * than an empty field.
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
 * Draft metadata for one asset.
 *
 * Returns a message rather than throwing for every expected failure -- no key
 * configured, nothing to read, the model declined -- because none of them are
 * bugs and all of them need to be readable in the inspector.
 */
export async function suggestMetadataForAsset(input: {
  organizationId: Id;
  assetId: Id;
  client?: SupabaseClient;
}): Promise<SuggestionOutcome> {
  if (!suggestionsAreConfigured()) {
    return {
      ok: false,
      error: "Metadata suggestions are not configured for this deployment.",
    };
  }

  const supabase = input.client ?? (await createClient());

  const { data: asset, error: assetError } = await supabase
    .from("assets")
    .select("id, shoot_id, captured_at, location_name, asset_kind")
    .eq("organization_id", input.organizationId)
    .eq("id", input.assetId)
    .maybeSingle();

  if (assetError || !asset) return { ok: false, error: "That asset could not be read." };

  const frame = await readFrame(supabase, input.organizationId, input.assetId);
  if (!frame) {
    return {
      ok: false,
      error:
        "There is no readable preview for this file, so there is nothing to suggest from. Caption it by hand.",
    };
  }

  const shoot = asset.shoot_id
    ? await getShoot(input.organizationId, asset.shoot_id as string)
    : null;

  const context: SuggestionContext = {
    shootTitle: shoot?.title,
    storyAngle: shoot?.storyAngle,
    // The asset's own location wins over the shoot's: it may have been
    // corrected on this frame after being inherited.
    locationName: (asset.location_name as string | null) ?? shoot?.locationName,
    capturedAt: (asset.captured_at as string | null) ?? undefined,
    isVideo: frame.fromVideo || asset.asset_kind === "video",
  };

  try {
    const client = new Anthropic();

    const response = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      // Low effort: this is a short, well-specified description task, and the
      // photographer is standing on a pavement waiting for it.
      output_config: { effort: "low" },
      system: SUGGESTION_SYSTEM_PROMPT,
      tools: [SUGGESTION_TOOL],
      tool_choice: { type: "tool", name: SUGGESTION_TOOL.name },
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: frame.mediaType, data: frame.base64 },
            },
            { type: "text", text: buildSuggestionPrompt(context) },
          ],
        },
      ],
    });

    if (response.stop_reason === "refusal") {
      return {
        ok: false,
        error: "The model declined to describe this frame. Caption it by hand.",
      };
    }

    const call = response.content.find(
      (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
    );
    const suggestion = normaliseSuggestion(call?.input, describeBasis(context));

    if (!suggestion) {
      return { ok: false, error: "Nothing usable came back. Caption it by hand." };
    }

    return { ok: true, suggestion };
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) {
      return { ok: false, error: "Too many suggestions at once. Try again in a moment." };
    }
    if (error instanceof Anthropic.AuthenticationError) {
      return { ok: false, error: "The suggestion service rejected this deployment's key." };
    }
    if (error instanceof Anthropic.APIError) {
      return { ok: false, error: `The suggestion service returned ${error.status}.` };
    }
    return {
      ok: false,
      error: error instanceof Error ? error.message : "The suggestion could not be made.",
    };
  }
}
