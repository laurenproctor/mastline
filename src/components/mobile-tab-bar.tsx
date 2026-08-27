import Link from "next/link";
// The label type only; a value import from app-shell would close a cycle,
// since that is what renders this.
import type { NavLabel } from "./app-shell";
import { Avatar } from "./avatar";
import { NavIcon } from "./nav-icons";

/**
 * PROTOTYPE. Not wired on by default -- see NAV_PROTOTYPE_COOKIE in app-shell.
 *
 * The phone's primary navigation, moved to the bottom of the window.
 *
 * The problem it answers is not the height of the top header, which could be
 * trimmed where it stands. It is that the header scrolls away: Settings is five
 * screens tall on a 390px phone and Money is three and a half, so moving
 * between two destinations means scrolling back to the top first. iOS gives you
 * a status-bar tap for that. Android gives you nothing.
 *
 * Four tabs and an overflow, rather than nine of equal weight. The four are the
 * operating loop the product already claims in the sidebar's own ordering --
 * shoot, submit, get paid, and the queue that says which to do next. The rest
 * are real destinations but not per-session ones, so they sit behind More
 * together with the account, which is where the sidebar kept them anyway.
 */
const PRIMARY = [
  { href: "/work", icon: "work", label: "Work" },
  { href: "/shoots", icon: "shoots", label: "Shoots" },
  { href: "/submissions", icon: "submissions", label: "Submissions" },
  { href: "/money", icon: "money", label: "Money" },
] as const;

const OVERFLOW = [
  { href: "/news", icon: "news", label: "News radar" },
  { href: "/work/commercial", icon: "commercial", label: "Commercial" },
  { href: "/rights", icon: "rights", label: "Rights" },
  { href: "/archive", icon: "archive", label: "Archive" },
  { href: "/settings", icon: "settings", label: "Settings" },
] as const;

export function MobileTabBar({
  active,
  avatar,
  displayName,
  initials,
  workspaceName,
  roleLabel,
}: {
  active?: NavLabel;
  avatar?: string;
  displayName: string;
  initials: string;
  workspaceName: string;
  roleLabel: string;
}) {
  // More carries the current destination's mark when the destination is inside
  // it, so the bar never looks as though you are nowhere.
  const activeInOverflow = OVERFLOW.some((item) => item.label === active);

  return (
    <nav aria-label="Primary" className="tab-bar">
      {PRIMARY.map((item) => (
        <Link
          aria-current={active === item.label ? "page" : undefined}
          className={active === item.label ? "tab active" : "tab"}
          href={item.href}
          key={item.href}
        >
          <NavIcon name={item.icon} />
          <span>{item.label}</span>
        </Link>
      ))}
      {/*
       * A disclosure rather than a scripted sheet: it opens, closes, takes
       * focus and answers the keyboard on its own, with nothing to hydrate. The
       * one thing it does not do is close on Escape, which a real one should.
       */}
      <details className="tab-more">
        <summary
          aria-current={activeInOverflow ? "page" : undefined}
          className={activeInOverflow ? "tab tab-more-summary active" : "tab tab-more-summary"}
        >
          <svg
            aria-hidden="true"
            className="nav-icon"
            fill="none"
            height="18"
            stroke="currentColor"
            strokeLinecap="round"
            strokeWidth="2"
            viewBox="0 0 18 18"
            width="18"
          >
            <path d="M4 9h.01M9 9h.01M14 9h.01" />
          </svg>
          <span>More</span>
        </summary>

        <div className="tab-sheet">
          <div className="tab-sheet-account">
            <Avatar initials={initials} url={avatar} />
            <span>
              <strong>{displayName}</strong>
              <small>
                {workspaceName} · {roleLabel}
              </small>
            </span>
          </div>

          {OVERFLOW.map((item) => (
            <Link
              aria-current={active === item.label ? "page" : undefined}
              className={active === item.label ? "tab-sheet-link active" : "tab-sheet-link"}
              href={item.href}
              key={item.href}
            >
              <NavIcon name={item.icon} />
              <span>{item.label}</span>
            </Link>
          ))}

          <form action="/auth/sign-out" method="post">
            <button className="tab-sheet-signout" type="submit">
              Sign out
            </button>
          </form>
        </div>
      </details>
    </nav>
  );
}
