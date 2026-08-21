import { cookies } from "next/headers";
import Image from "next/image";
import Link from "next/link";
import { ACTIVE_WORKSPACE_COOKIE, requireSession } from "@/lib/auth";
import { humanizeStatus } from "@/lib/format";
import { getWorkspaceStatus } from "@/lib/data/subscription";
import { WorkspaceBanner } from "./workspace-banner";
import { WorkspaceSwitcher } from "./workspace-switcher";

/** Primary navigation. The order is the operating loop, not alphabetical. */
const NAV = [
  { href: "/work", icon: "⌂", label: "Work" },
  { href: "/news", icon: "◉", label: "News radar" },
  { href: "/shoots", icon: "▣", label: "Shoots" },
  { href: "/submissions", icon: "➤", label: "Submissions" },
  { href: "/money", icon: "$", label: "Money" },
  { href: "/rights", icon: "©", label: "Rights" },
  { href: "/archive", icon: "□", label: "Archive" },
] as const;

export type NavLabel = (typeof NAV)[number]["label"] | "Settings";

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
  children,
}: {
  active?: NavLabel;
  children: React.ReactNode;
}) {
  const cookieStore = await cookies();
  const session = await requireSession(cookieStore.get(ACTIVE_WORKSPACE_COOKIE)?.value);
  const { activeWorkspace } = session;
  const status = await getWorkspaceStatus(activeWorkspace);

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        Skip to main content
      </a>

      <aside className="sidebar">
        <Link className="brand" href="/work">
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
                href={item.href}
                key={item.href}
              >
                <span aria-hidden="true" className="nav-icon">
                  {item.icon}
                </span>
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="sidebar-foot">
          <Link
            aria-current={active === "Settings" ? "page" : undefined}
            className={active === "Settings" ? "nav-link active" : "nav-link"}
            href="/settings"
          >
            <span aria-hidden="true" className="nav-icon">
              ⚙
            </span>
            <span>Settings</span>
          </Link>

          <div className="profile">
            <span aria-hidden="true" className="avatar">
              {session.initials}
            </span>
            <span>
              <strong>{session.displayName}</strong>
              <small>
                {activeWorkspace.name} ·{" "}
                {ROLE_LABELS[activeWorkspace.role] ?? humanizeStatus(activeWorkspace.role)}
              </small>
            </span>
          </div>

          <form action="/auth/signout" method="post">
            <button className="signout" type="submit">
              Sign out
            </button>
          </form>
        </div>
      </aside>

      <main className="workspace" id="main">
        <WorkspaceBanner notice={status.notice} />
        {children}
      </main>
    </div>
  );
}
