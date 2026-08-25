import { GateShell } from "@/components/gate-shell";
import { brandSans, brandSerif } from "@/lib/brand-fonts";
import "@/app/(marketing)/marketing.css";
import "@/app/gate.css";

/** Asking for a reset link, and choosing the new password once it is followed. */
export default function ResetPasswordLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`mkt gate-shell ${brandSans.variable} ${brandSerif.variable}`}>
      <GateShell action={{ prompt: "Remembered it?", label: "Sign in", href: "/login" }}>
        {children}
      </GateShell>
    </div>
  );
}
