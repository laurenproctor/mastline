import Image from "next/image";
import Link from "next/link";
import { PricingTable } from "@/components/pricing-table";
import { SALES_ENGINE_PHOTOGRAPHER_RATE, SALES_ENGINE_PLATFORM_RATE } from "@/lib/sales-engine";

export default function PricingPage() {
  const photographerShare = Math.round(SALES_ENGINE_PHOTOGRAPHER_RATE * 100);
  const platformShare = Math.round(SALES_ENGINE_PLATFORM_RATE * 100);

  return (
    <main className="marketing">
      <nav className="marketing-nav">
        <Image alt="Mastline" height={33} src="/mastline-wordmark.png" width={190} />
        <div>
          <Link href="/welcome">Home</Link>
          <Link className="button primary" href="/work">
            Open demo
          </Link>
        </div>
      </nav>

      <section className="pricing-section">
        <div className="pricing-intro">
          <div>
            <div className="eyebrow">Choose your operating level</div>
            <h1>
              Built for the way
              <br />
              you work now.
            </h1>
          </div>
        </div>

        <PricingTable />

        <p className="sales-engine-note">
          All paid plans include the optional Mastline Sales Engine. The photographer receives{" "}
          {photographerShare}% and Mastline receives {platformShare}% only on licenses generated
          inside Mastline.
        </p>
      </section>
    </main>
  );
}
