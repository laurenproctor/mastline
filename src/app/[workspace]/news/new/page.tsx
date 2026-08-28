import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { PageHeader, Panel } from "@/components/primitives";
import { parseNewsMode } from "@/lib/news-radar";
import { can } from "@/lib/permissions";
import { workspaceContext } from "@/lib/session-context";
import { workspaceRoutes } from "@/lib/workspace-routes";
import { StoryForm } from "../_components/story-form";

/**
 * Manual story entry.
 *
 * The first release of News Radar runs on stories entered by hand, so the
 * lifecycle can be proven with a live operator before any feed is connected.
 * One entry creates one canonical signal and both evaluation paths -- archive
 * value and new-shoot potential -- plus one activity event, and nothing else:
 * no contact, no shoot, no package, no send.
 */
export default async function NewStoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspace: string }>;
  searchParams: Promise<{ mode?: string }>;
}) {
  const { workspace: requestedWorkspace } = await params;
  const { session, canonicalSlug } = await workspaceContext(requestedWorkspace);
  const routes = workspaceRoutes(canonicalSlug);
  /*
   * Everything below builds on the address the workspace holds NOW, not the one
   * the request arrived on. A request may land on a retired address, and a link
   * rendered from that would send the next click back through the rename
   * redirect; a slug that was never resolved at all would be a value the
   * browser supplied, sitting in a destination.
   */
  const workspaceSlug = canonicalSlug;
  const role = session.activeWorkspace.role;

  // The mode the form was opened from decides only which of the two freshly
  // created paths opens afterwards. Both always exist.
  const mode = parseNewsMode((await searchParams).mode);

  // A role that cannot add stories is told so, rather than being shown a form
  // whose submit will be refused.
  if (!can(role, "opportunity.write")) {
    return (
      <AppShell active="News radar" workspace={workspaceSlug}>
        <div className="page">
          <PageHeader
            description="This role can read the radar but not add stories to it."
            eyebrow="Not available"
            title="Add story"
          />
          <Panel>
            <div className="panel-body">
              <p className="section-note">
                Adding a story needs an owner or editor role in this workspace. Ask an owner to
                change the role, or read the radar as it stands.
              </p>
              <div className="spacer" />
              <Link className="button" href={routes.news()}>
                Back to News Radar
              </Link>
            </div>
          </Panel>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell active="News radar" workspace={workspaceSlug}>
      <div className="page">
        <PageHeader
          description="Enter a story once. It is evaluated for both archive value — photographs you already own — and new-shoot potential, each decided independently."
          eyebrow="Manual entry · live feeds not yet connected"
          title="Add story"
        />

        <Panel title="The story">
          <div className="panel-body">
            <StoryForm mode={mode} workspaceSlug={workspaceSlug} />
          </div>
        </Panel>

        <p className="section-note">
          <Link className="text-link" href={routes.news({ query: { mode } })}>
            Back to News Radar
          </Link>{" "}
          — nothing is lost by leaving; a story not yet added was never recorded.
        </p>
      </div>
    </AppShell>
  );
}
