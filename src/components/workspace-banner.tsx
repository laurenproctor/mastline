import Link from "next/link";
import type { WorkspaceNotice } from "@/lib/subscription";

/**
 * The one notice a workspace is shown, if any.
 *
 * At most one, chosen by severity, because a banner for every condition teaches
 * people to ignore banners. Rendered as a region so it is announced, and
 * carrying its own words rather than relying on colour.
 */
export function WorkspaceBanner({ notice }: { notice: WorkspaceNotice | null }) {
  if (!notice) return null;

  return (
    <aside aria-label="Workspace status" className={`workspace-banner ${notice.tone}`}>
      <div>
        <strong>{notice.headline}</strong>
        <p>{notice.detail}</p>
      </div>
      {notice.action && (
        <Link className="button small" href={notice.action.href}>
          {notice.action.label}
        </Link>
      )}
    </aside>
  );
}
