import { GateShell } from "@/components/gate-shell";
import { brandSans, brandSerif } from "@/lib/brand-fonts";
import "@/app/(marketing)/marketing.css";
import "@/app/gate.css";

/**
 * Signing in, and the two-factor challenge that follows it.
 *
 * The same shell as sign-up, because somebody who clicked the wrong one of the
 * two should not feel they have changed product. What differs is the way out:
 * the alternative offered here is starting an account, not signing in.
 */
export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`mkt gate-shell ${brandSans.variable} ${brandSerif.variable}`}>
      <GateShell action={{ prompt: "New to Mastline?", label: "Start free", href: "/signup" }}>
        {children}
      </GateShell>
    </div>
  );
}
