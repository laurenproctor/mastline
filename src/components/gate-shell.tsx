import Image from "next/image";
import Link from "next/link";

/**
 * The chrome shared by every screen that gets somebody into a workspace.
 *
 * Deliberately thinner than the marketing site's: one way back to the front
 * page, one way to whichever of these screens the visitor probably wanted
 * instead, and no navigation to wander off into from a page whose whole job is
 * a form.
 */
export function GateShell({
  action,
  children,
}: {
  /** The one alternative offered top right, e.g. sign in from sign up. */
  action: { prompt: string; label: string; href: string };
  children: React.ReactNode;
}) {
  return (
    <>
      <a className="skip" href="#main">
        Skip to the form
      </a>
      <header className="gate-head">
        <Link aria-label="Mastline home" className="gate-logo" href="/">
          <Image alt="Mastline" height={137} priority src="/marketing/wordmark.png" width={800} />
        </Link>
        <p className="gate-alt">
          <span>{action.prompt}</span> <Link href={action.href}>{action.label}</Link>
        </p>
      </header>
      {children}
    </>
  );
}
