import { cookies } from "next/headers";
import Image from "next/image";
import Link from "next/link";
import { ACTIVE_WORKSPACE_COOKIE, requireSession } from "@/lib/auth";
import { humanizeStatus } from "@/lib/format";
import { getWorkspaceStatus } from "@/lib/data/subscription";
import { Avatar } from "./avatar";
import { getProfile, signAvatarUrl } from "@/lib/data/profiles";
import { WorkspaceBanner } from "./workspace-banner";
import { WorkspaceSwitcher } from "./workspace-switcher";

/**
 * Navigation icons, drawn.
 *
 * These were Unicode glyphs -- ⌂ ◉ ▣ ➤ $ © □ -- which every platform renders at
 * a different weight, size and baseline, so the column read as seven unrelated
 * marks. One 18px grid, one stroke width, currentColor throughout.
 */
const ICONS = {
  work: "M3 8.5 9 3.5l6 5V15a.5.5 0 0 1-.5.5h-3v-4h-5v4h-3A.5.5 0 0 1 3 15z",
  news: "M4.5 5.5h9v7h-9zM6.5 8h5M6.5 10h3",
  shoots: "M2.5 6h13v8.5h-13zM6 6l1.2-2h3.6L12 6M9 12.2a2.4 2.4 0 1 0 0-4.8 2.4 2.4 0 0 0 0 4.8",
  submissions: "M15 3.5 8 10M15 3.5l-4.4 11.6-2.2-5-5-2.2z",
  money:
    "M9 3v12M11.8 5.6c-.6-.7-1.6-1.1-2.8-1.1-1.7 0-2.8.8-2.8 2s1 1.8 2.8 2.1c1.9.4 3 1 3 2.2s-1.2 2.1-3 2.1c-1.3 0-2.4-.4-3-1.2",
  rights:
    "M9 2.5a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13M11.2 7.2A2.6 2.6 0 0 0 9 6.1a2.9 2.9 0 0 0 0 5.8 2.6 2.6 0 0 0 2.2-1.1",
  archive: "M2.5 4h13v3h-13zM4 7v7.5h10V7M7 10h4",
  settings:
    "M9 6.6a2.4 2.4 0 1 0 0 4.8 2.4 2.4 0 0 0 0-4.8M9 2.5l.5 1.8 1.8.5 1.5-1.1 1.5 1.5-1.1 1.5.5 1.8 1.8.5v2.1l-1.8.5-.5 1.8 1.1 1.5-1.5 1.5-1.5-1.1-1.8.5-.5 1.8H7.9l-.5-1.8-1.8-.5-1.5 1.1-1.5-1.5 1.1-1.5-.5-1.8-1.8-.5V9.6l1.8-.5.5-1.8L2.6 5.8l1.5-1.5 1.5 1.1 1.8-.5.5-1.8z",
} as const;

export function NavIcon({ name }: { name: keyof typeof ICONS }) {
  return (
    <svg
      aria-hidden="true"
      className="nav-icon"
      fill="none"
      height="18"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.35"
      viewBox="0 0 18 18"
      width="18"
    >
      <path d={ICONS[name]} />
    </svg>
  );
}

/** Primary navigation. The order is the operating loop, not alphabetical. */
const NAV = [
  { href: "/work", icon: "work", label: "Work" },
  { href: "/news", icon: "news", label: "News radar" },
  { href: "/shoots", icon: "shoots", label: "Shoots" },
  { href: "/submissions", icon: "submissions", label: "Submissions" },
  { href: "/money", icon: "money", label: "Money" },
  { href: "/rights", icon: "rights", label: "Rights" },
  { href: "/archive", icon: "archive", label: "Archive" },
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
            href="/settings"
          >
            <NavIcon name="settings" />
            <span>Settings</span>
          </Link>

          <div className="profile">
            <Avatar
              initials={session.initials}
              url={await signAvatarUrl((await getProfile(session.userId))?.avatarPath)}
            />
            <span>
              <strong>{session.displayName}</strong>
              <small>
                {activeWorkspace.name} ·{" "}
                {ROLE_LABELS[activeWorkspace.role] ?? humanizeStatus(activeWorkspace.role)}
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

      <main className="workspace" id="main">
        <WorkspaceBanner notice={status.notice} />
        {children}
      </main>
    </div>
  );
}
