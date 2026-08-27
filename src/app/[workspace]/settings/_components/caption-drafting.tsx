"use client";

import { useActionState } from "react";
import { type CaptionDraftingState, setCaptionDraftingAction } from "../actions";

const INITIAL: CaptionDraftingState = {};

/**
 * The switch for drafting a caption on every frame as it is imported.
 *
 * Written to be read by someone deciding whether to trust it, so it says three
 * things a settings row usually leaves out: that it costs money, that it never
 * names anybody, and that a drafted caption still has to be read before the
 * frame can be sent anywhere. The last one is the important one -- without it,
 * a photographer could reasonably believe this captions their work for them,
 * and find out otherwise at the dispatch gate with a desk waiting.
 */
export function CaptionDrafting({
  workspaceSlug,
  enabled,
  canChange,
}: {
  workspaceSlug: string;
  enabled: boolean;
  canChange: boolean;
}) {
  const [state, formAction, pending] = useActionState(
    setCaptionDraftingAction.bind(null, workspaceSlug),
    INITIAL,
  );

  if (!canChange) {
    return (
      <p className="section-note">
        {enabled
          ? "Captions are drafted automatically as frames are imported. Each one waits to be read before the frame can be dispatched."
          : "Captions are not drafted automatically. Use Suggest in the inspector to draft one frame at a time."}
      </p>
    );
  }

  return (
    <form action={formAction} className="panel-body">
      <input name="enabled" type="hidden" value={enabled ? "off" : "on"} />
      <p className="section-note">
        {enabled
          ? "Every imported frame with a preview is described as it lands, and the draft goes straight into its caption. It is marked as unread until somebody opens the frame and saves it, and an unread caption never passes the dispatch gate."
          : "Frames are imported without captions. The Suggest button in the inspector still drafts one frame at a time."}
      </p>
      <p className="section-note">
        People are never named or described. That is the photographer&rsquo;s to record, and it is
        the one field this will not touch.
      </p>
      {state.error && (
        <p className="auth-error" role="alert">
          {state.error}
        </p>
      )}
      <button className="button small" disabled={pending} type="submit">
        {pending ? "Saving…" : enabled ? "Stop drafting captions" : "Draft captions at import"}
      </button>
      {enabled && (
        <p className="section-note">
          Roughly half a cent a frame. A four hundred frame card is about two dollars.
        </p>
      )}
    </form>
  );
}
