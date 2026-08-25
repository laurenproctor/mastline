import { GateShell } from "@/components/gate-shell";
import { brandSans, brandSerif } from "@/lib/brand-fonts";
import "@/app/(marketing)/marketing.css";
import "@/app/gate.css";

/**
 * The handover.
 *
 * Every "Start free" on the public site points here, so this screen is the last
 * page of the marketing site rather than the first page of the application: it
 * borrows the editorial direction, not the operating language.
 */
export default function SignUpLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`mkt gate-shell ${brandSans.variable} ${brandSerif.variable}`}>
      <GateShell action={{ prompt: "Already have an account?", label: "Sign in", href: "/sign-in" }}>
        {children}
      </GateShell>
    </div>
  );
}
