import { switchWorkspace } from "@/app/workspace/actions";
import { Button } from "@/components/button";
import { Field } from "@/components/field";
import type { Workspace } from "@/lib/auth";

/**
 * Shown only when a person belongs to more than one workspace, per the global
 * shell specification.
 *
 * A native select and a submit button, on purpose: the choice posts to a
 * Server Action and the page comes back as the other workspace, so there is
 * nothing here for client state to do. The field's own id binds the label,
 * and `organizationId` is the name the action reads.
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
      <Field control="select" defaultValue={activeId} label="Workspace" name="organizationId">
        {workspaces.map((workspace) => (
          <option key={workspace.id} value={workspace.id}>
            {workspace.name}
          </option>
        ))}
      </Field>
      <Button size="sm" type="submit" variant="secondary">
        Switch
      </Button>
    </form>
  );
}
