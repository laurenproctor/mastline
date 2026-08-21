import { switchWorkspace } from "@/app/workspace/actions";
import type { Workspace } from "@/lib/auth";

/**
 * Shown only when a person belongs to more than one workspace, per the global
 * shell specification.
 */
export function WorkspaceSwitcher({
  workspaces,
  activeId,
}: {
  workspaces: readonly Workspace[];
  activeId: string;
}) {
  if (workspaces.length < 2) return null;

  return (
    <form action={switchWorkspace} className="workspace-switcher">
      <label className="eyebrow" htmlFor="workspace-select">
        Workspace
      </label>
      <select defaultValue={activeId} id="workspace-select" name="organizationId">
        {workspaces.map((workspace) => (
          <option key={workspace.id} value={workspace.id}>
            {workspace.name}
          </option>
        ))}
      </select>
      <button className="button small" type="submit">
        Switch
      </button>
    </form>
  );
}
