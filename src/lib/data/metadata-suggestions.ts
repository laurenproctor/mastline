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
  supportsEffort,
} from "../metadata-suggestions";
import { createClient } from "../supabase/server";
import { recordEventWith } from "./activity";
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

/**
 * Haiku 4.5: the cheapest model that can see, and this is not a hard seeing
 * task. Describing what is visible in one frame is exactly the kind of short,
 * well-specified work the small model is for, and the cost difference decides
 * whether the feature can be offered on every frame or only on a chosen few.
 * At roughly 0.6 of a cent a suggestion it can be offered on every frame.
 *
 * Overridable per deployment. Changing it needs a redeploy, not just a restart:
 * the value is read on the server at request time, but Vercel only hands a new
 * environment to a new deployment.
 */
const MODEL = process.env.MASTLINE_SUGGESTION_MODEL ?? "claude-haiku-4-5";

/**
 * Which Anthropic workspace this deployment's requests act in.
 *
 * Only needed because the key is identity-backed and not scoped to a single
 * workspace. Such a key can act in several, so the API refuses to guess and
 * returns a 400 naming this header rather than billing the wrong one. A key
 * created against one workspace carries its own scope and needs nothing here.
 *
 * Left unset, no header is sent -- which is correct for a scoped key and is
 * also what makes moving to one later a matter of clearing a variable rather
 * than a code change. Sending a workspace id that contradicts a scoped key's
 * own workspace is a 404, so this is not a value to set speculatively.
 */
const WORKSPACE_ID = process.env.ANTHROPIC_WORKSPACE_ID?.trim();

/**
 * A suggestion is a short, structured draft, not an essay. The cap is generous
 * enough for the tool call plus whatever thinking the model does on the way to
 * it, and small enough that a runaway response cannot become an expensive one.
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
        items: { type: "string" },
        /*
         * The cap is stated here rather than expressed as `maxItems`, which
         * `strict: true` rejects outright -- "For 'array' type, property
         * 'maxItems' is not supported" -- taking every suggestion with it. It
         * was never the thing enforcing the limit anyway: normaliseSuggestion
         * slices to MAX_KEYWORDS on the way in, because a cap that lives only
         * in a schema the model is asked to honour is not a cap.
         */
        description: `Lowercase search terms, at most ${MAX_KEYWORDS}. No names of people.`,
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
    const client = new Anthropic(
      WORKSPACE_ID ? { defaultHeaders: { "anthropic-workspace-id": WORKSPACE_ID } } : {},
    );

    const response = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      // Low effort where the model takes it at all: this is a short, well
      // specified description task, and the photographer is standing on a
      // pavement waiting for it.
      ...(supportsEffort(MODEL) ? { output_config: { effort: "low" as const } } : {}),
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

/**
 * Draft a caption for a frame that has just been imported.
 *
 * This is the automatic path: the browser registers a preview, and this runs
 * behind the response so that by the time the operator looks at the shoot, the
 * frames already carry words. It is the same model call as the inspector
 * button; what differs is that nobody asked for this one, so everything below
 * is about being safe to run unattended.
 *
 * Four rules hold it together:
 *
 *   1. The workspace has to want it. Read here rather than trusted from the
 *      caller, so the switch cannot be forgotten at a call site.
 *   2. It only ever fills an empty field. The guarded update means a caption
 *      the operator typed while the model was still reading -- entirely
 *      possible, since an import returns long before a vision call does --
 *      wins, and the draft is dropped rather than written over it.
 *   3. What it writes is marked as a draft. `caption_origin` is "model" and no
 *      reviewer is recorded, so `caption_awaits_review` is true and the
 *      dispatch gate refuses the frame until a person reads it.
 *   4. Nothing here throws. A frame with no caption is a normal state that the
 *      inspector already handles; a failed draft must never fail an import that
 *      has already safely stored an original.
 */
export interface DraftOutcome {
  readonly written: boolean;
  /** Why not, when nothing was written. For logs and tests, not for a buyer. */
  readonly reason?: string;
}

export async function draftCaptionOnImport(input: {
  organizationId: Id;
  actorId: Id;
  assetId: Id;
  client?: SupabaseClient;
}): Promise<DraftOutcome> {
  const supabase = input.client ?? (await createClient());

  const { data: organization } = await supabase
    .from("organizations")
    .select("auto_caption_on_import")
    .eq("id", input.organizationId)
    .maybeSingle();

  if (!organization) return { written: false, reason: "workspace-unreadable" };
  if (organization.auto_caption_on_import === false) return { written: false, reason: "disabled" };

  const outcome = await suggestMetadataForAsset({
    organizationId: input.organizationId,
    assetId: input.assetId,
    client: supabase,
  });

  if (!outcome.ok || !outcome.suggestion) {
    return { written: false, reason: outcome.error ?? "no-suggestion" };
  }

  const suggestion = outcome.suggestion;
  if (!suggestion.caption) return { written: false, reason: "no-caption-in-suggestion" };

  /*
   * Read the neighbouring fields before deciding what to write.
   *
   * The headline and keywords are drafted in the same call and are worth
   * keeping, but they are not what this feature is for and they must not
   * overwrite anything. Each is written only if it is still empty, which is why
   * this is a read rather than a blind update: `is null` in the WHERE clause
   * can guard one column, not three independently.
   */
  const { data: current } = await supabase
    .from("assets")
    .select("headline, keywords")
    .eq("organization_id", input.organizationId)
    .eq("id", input.assetId)
    .maybeSingle();

  const headlineIsEmpty = !String(current?.headline ?? "").trim();
  const keywordsAreEmpty = !Array.isArray(current?.keywords) || current.keywords.length === 0;

  const { data: written, error } = await supabase
    .from("assets")
    .update({
      caption: suggestion.caption,
      caption_origin: "model",
      caption_drafted_at: new Date().toISOString(),
      caption_basis: suggestion.basis,
      caption_confidence: suggestion.confidence,
      caption_model: MODEL,
      ...(headlineIsEmpty && suggestion.headline ? { headline: suggestion.headline } : {}),
      ...(keywordsAreEmpty && suggestion.keywords.length > 0
        ? { keywords: suggestion.keywords }
        : {}),
    })
    .eq("organization_id", input.organizationId)
    .eq("id", input.assetId)
    // The race guard. Whoever typed first keeps their words.
    .is("caption", null)
    .select("id");

  if (error) return { written: false, reason: error.message };
  if (!written || written.length === 0) return { written: false, reason: "caption-already-set" };

  /*
   * Recorded as an event because it is a change to a commercial record that no
   * person asked for. The basis and confidence go in the event as well as the
   * row: the row keeps the current answer, the event keeps what was true when
   * the decision was made, which is the question an audit actually asks.
   */
  await recordEventWith(supabase, {
    organizationId: input.organizationId,
    actorId: input.actorId,
    entityType: "asset",
    entityId: input.assetId,
    action: "asset.caption_drafted",
    data: {
      summary: "Caption drafted at import, awaiting review",
      basis: suggestion.basis,
      confidence: suggestion.confidence,
      model: MODEL,
    },
  });

  return { written: true };
}
