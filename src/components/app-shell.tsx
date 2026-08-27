import { cookies } from "next/headers";
import Image from "next/image";
import Link from "next/link";
import { requireWorkspace } from "@/lib/auth";
import { humanizeStatus } from "@/lib/format";
import { getWorkspaceStatus } from "@/lib/data/subscription";
import { Avatar } from "./avatar";
import { getProfile, signAvatarUrl } from "@/lib/data/profiles";
import { WorkspaceBanner } from "./workspace-banner";
import { WorkspaceSwitcher } from "./workspace-switcher";
import { MobileTabBar } from "./mobile-tab-bar";
import { NavIcon } from "./nav-icons";
import { NavPrototypeToggle } from "./nav-prototype-toggle";
import { type WorkspaceRoutes, workspaceRoutes } from "@/lib/workspace-routes";

/**
 * Primary navigation. The order is the operating loop, not alphabetical.
 *
 * Each destination is asked for by name rather than written as a path, so a
 * nav entry cannot be the one link in the application that forgot its
 * workspace.
 */
const NAV = [
  { to: (r: WorkspaceRoutes) => r.work(), icon: "work", label: "Work" },
  { to: (r: WorkspaceRoutes) => r.news(), icon: "news", label: "News radar" },
  { to: (r: WorkspaceRoutes) => r.shoots(), icon: "shoots", label: "Shoots" },
  { to: (r: WorkspaceRoutes) => r.submissions(), icon: "submissions", label: "Submissions" },
  { to: (r: WorkspaceRoutes) => r.commercial(), icon: "commercial", label: "Commercial" },
  { to: (r: WorkspaceRoutes) => r.money(), icon: "money", label: "Money" },
  { to: (r: WorkspaceRoutes) => r.rights(), icon: "rights", label: "Rights" },
  { to: (r: WorkspaceRoutes) => r.archive(), icon: "archive", label: "Archive" },
] as const;

export type NavLabel = (typeof NAV)[number]["label"] | "Settings";

export { NavIcon };

/*
 * PROTOTYPE. Which phone navigation to draw.
 *
 * "tiles" is what ships: the sidebar lying down across the top of the page as a
 * grid of icon-over-label tiles. "bottom" is the alternative under evaluation,
 * where the four loop destinations move to a fixed bar at the bottom of the
 * window and the rest go behind More.
 *
 * Absent cookie means tiles, so nothing changes for anybody who has not asked
 * to see the other one. Delete this, MobileTabBar, and NavPrototypeToggle
 * together once the question is settled either way.
 */
const NAV_PROTOTYPE_COOKIE = "mastline_nav";

/**
 * Whether the prototype offers its own switch.
 *
 * The switch shipped ungated, so every signed-in person on mastline.co was
 * being shown a dashed chip belonging to a question only we are asking. The
 * bar itself was always inert without the cookie; the control that sets the
 * cookie was not, and that is the half that reached real people.
 *
 * Opt-in by name rather than by NODE_ENV, because `next start` runs in
 * production mode locally too and gating on that would have taken the switch
 * away from the machine it is meant to be used on. Set
 * NEXT_PUBLIC_NAV_PROTOTYPE=1 in .env.local, or on a preview deployment to try
 * the bar on a real phone. Unset everywhere else, which includes production.
 */
const NAV_PROTOTYPE_OFFERED = process.env.NEXT_PUBLIC_NAV_PROTOTYPE === "1";

const ROLE_LABELS: Record<string, string> = {
  owner: "Owner · all access",
  editor: "Editor · assets and dispatch",
  dispatcher: "Dispatcher · delivery and status",
  finance: "Finance · revenue and payments",
  rights_reviewer: "Rights reviewer · evidence and checks",
  viewer: "Viewer · read only",
};

export async function AppShell({
  active,
  workspace,
  children,
}: {
  active?: NavLabel;
  /** The address in the URL. Membership decides; this only looks it up. */
  workspace: string;
  children: React.ReactNode;
}) {
  const cookieStore = await cookies();
  const session = await requireWorkspace(workspace);
  const { activeWorkspace } = session;

  /*
   * Links are built from the address the workspace holds now, not from the one
   * that was requested. A request can arrive on a retired address -- the
   * middleware redirects those, but a link rendered from the requested slug
   * would send the next click back through the redirect for no reason.
   */
  const routes = workspaceRoutes(activeWorkspace.slug);
  const status = await getWorkspaceStatus(activeWorkspace);
  const avatar = await signAvatarUrl((await getProfile(session.userId))?.avatarPath);
  const roleLabel = ROLE_LABELS[activeWorkspace.role] ?? humanizeStatus(activeWorkspace.role);
  const navMode = cookieStore.get(NAV_PROTOTYPE_COOKIE)?.value === "bottom" ? "bottom" : "tiles";

  return (
    <div className={navMode === "bottom" ? "app-shell nav-bottom" : "app-shell"}>
      <a className="skip-link" href="#main">
        Skip to main content
      </a>

      <aside className="sidebar">
        <Link className="brand" href={routes.work()}>
          <Image
            alt="Mastline — go to the work queue"
            height={30}
            priority
            src="/mastline-wordmark.png"
            width={174}
          />
        </Link>

        <WorkspaceSwitcher activeId={activeWorkspace.id} workspaces={session.workspaces} />

        <nav aria-label="Primary">
          {NAV.map((item) => {
            const isActive = active === item.label;
            return (
              <Link
                aria-current={isActive ? "page" : undefined}
                className={isActive ? "nav-link active" : "nav-link"}
                href={item.to(routes)}
                key={item.label}
              >
                <NavIcon name={item.icon} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="sidebar-foot">
          <Link
            aria-current={active === "Settings" ? "page" : undefined}
            className={active === "Settings" ? "nav-link active" : "nav-link"}
            href={routes.settings()}
          >
            <NavIcon name="settings" />
            <span>Settings</span>
          </Link>

          <div className="profile">
            <Avatar initials={session.initials} url={avatar} />
            <span>
              <strong>{session.displayName}</strong>
              <small>
                {activeWorkspace.name} · {roleLabel}
              </small>
            </span>
          </div>

          <form action="/auth/sign-out" method="post">
            <button className="signout" type="submit">
              Sign out
            </button>
          </form>
        </div>
      </aside>

      {/* PROTOTYPE. Only drawn under the flag, and only on a phone by CSS. */}
      {navMode === "bottom" && (
        <>
          <div className="mobile-top">
            <Link className="mobile-top-brand" href={routes.work()}>
              <Image
                alt="Mastline — go to the work queue"
                height={26}
                priority
                src="/mastline-wordmark.png"
                width={150}
              />
            </Link>
          </div>
          <MobileTabBar
            active={active}
            avatar={avatar}
            workspaceSlug={activeWorkspace.slug}
            displayName={session.displayName}
            initials={session.initials}
            roleLabel={roleLabel}
            workspaceName={activeWorkspace.name}
          />
        </>
      )}

      <main className="workspace" id="main">
        <WorkspaceBanner notice={status.notice} />
        {children}
      </main>

      {NAV_PROTOTYPE_OFFERED && <NavPrototypeToggle mode={navMode} />}
    </div>
  );
}
