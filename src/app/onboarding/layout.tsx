import { brandSans, brandSerif } from "@/lib/brand-fonts";
import "./onboarding.css";

export default function OnboardingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`onboarding-shell ${brandSans.variable} ${brandSerif.variable}`}>
      {children}
    </div>
  );
}
