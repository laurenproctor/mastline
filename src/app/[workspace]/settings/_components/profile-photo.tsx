"use client";

import { useRef, useState, useTransition } from "react";
import { Avatar } from "@/components/avatar";
import { AVATAR_EDGE, canPreview, formatBytes, makeAvatar } from "@/lib/upload";
import { createClient } from "@/lib/supabase/client";
import { avatarUploadKeyAction, removeAvatarAction, setAvatarAction } from "../profile-actions";

/**
 * Choosing a photo.
 *
 * The file is squared and shrunk to 256px in this browser before anything is
 * sent, so a twelve-megabyte camera JPEG never crosses the wire to be shown as
 * a 34px circle. The upload then goes straight to storage, the same way an
 * import does, because the bucket policy already limits a caller to their own
 * prefix; the server action only records which object is now current.
 */
export function ProfilePhoto({
  workspaceSlug,
  initials,
  url,
  displayName,
}: {
  workspaceSlug: string;
  initials: string;
  url?: string;
  displayName: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | undefined>(url);
  const [error, setError] = useState<string | undefined>();
  const [busy, run] = useTransition();

  function choose(file: File | undefined) {
    if (!file) return;
    setError(undefined);

    if (!canPreview(file.type)) {
      setError("Choose a JPEG, PNG, or WebP image.");
      return;
    }

    run(async () => {
      const squared = await makeAvatar(file);
      if (!squared) {
        setError("That image could not be read. Try exporting it as a JPEG.");
        return;
      }

      const { key } = await avatarUploadKeyAction();
      const supabase = createClient();
      const upload = await supabase.storage.from("avatars").upload(key, squared, {
        contentType: "image/jpeg",
        upsert: false,
      });
      if (upload.error) {
        setError(`The upload did not finish: ${upload.error.message}`);
        return;
      }

      const saved = await setAvatarAction(workspaceSlug, key);
      if (saved.error) {
        setError(saved.error);
        return;
      }

      // Shown from the local copy rather than waiting for a signed URL to come
      // back around: the bytes are already here.
      setPreview(URL.createObjectURL(squared));
    });
  }

  function remove() {
    setError(undefined);
    run(async () => {
      const result = await removeAvatarAction(workspaceSlug);
      if (result.error) {
        setError(result.error);
        return;
      }
      setPreview(undefined);
      if (input.current) input.current.value = "";
    });
  }

  return (
    <div className="panel-body">
      <div className="profile-photo">
        <Avatar initials={initials} name={displayName} url={preview} />
        <div>
          <p className="section-note">
            Shown beside your name here and in the sidebar, to the people who share this workspace
            with you and to nobody else. Squared and reduced to {AVATAR_EDGE}px before it is
            uploaded, so nothing larger than {formatBytes(2097152)} is ever stored.
          </p>
          <div className="actions">
            <button
              className="button small"
              disabled={busy}
              onClick={() => input.current?.click()}
              type="button"
            >
              {busy ? "Working…" : preview ? "Change photo" : "Add a photo"}
            </button>
            {preview && (
              <button className="button small" disabled={busy} onClick={remove} type="button">
                Remove
              </button>
            )}
          </div>
        </div>
      </div>

      <input
        accept="image/jpeg,image/png,image/webp"
        className="visually-hidden"
        onChange={(event) => choose(event.target.files?.[0])}
        ref={input}
        type="file"
      />

      {error && (
        <p className="auth-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
