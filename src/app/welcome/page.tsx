import Image from "next/image";
import Link from "next/link";
import { SALES_ENGINE_PHOTOGRAPHER_RATE, SALES_ENGINE_PLATFORM_RATE } from "@/lib/sales-engine";

const photographerShare = Math.round(SALES_ENGINE_PHOTOGRAPHER_RATE * 100);
const platformShare = Math.round(SALES_ENGINE_PLATFORM_RATE * 100);

const LOOP = [
  ["Opportunity", "Know what matters now"],
  ["Shoot", "Run the job from one brief"],
  ["Dispatch", "Move while the story is alive"],
  ["Revenue", "See every expected dollar"],
] as const;

export default function MarketingPage() {
  return (
    <main className="marketing">
      <nav className="marketing-nav">
        <Image alt="Mastline" height={33} src="/mastline-wordmark.png" width={190} />
        <div>
          <Link href="#product">Product</Link>
          <Link href="#sales">Sales engine</Link>
          <Link href="#rights">Rights</Link>
          <Link href="/pricing">Pricing</Link>
          <Link className="button primary" href="/work">
            Open demo
          </Link>
        </div>
      </nav>

      <section className="marketing-hero">
        <div>
          <div className="eyebrow">The business operating system for paparazzi</div>
          <h1>Every image needs a commercial memory.</h1>
          <p>
            Find opportunities, run shoots, move images to market, track submissions and payments,
            manage rights, and turn an archive into recurring revenue.
          </p>
          <div className="hero-actions">
            <Link className="button blue" href="/work">
              Explore the product
            </Link>
            <Link className="button" href="/pricing">
              View pricing
            </Link>
          </div>
        </div>
        <div aria-hidden="true" className="hero-photo" />
      </section>

      <div className="marketing-proof">
        {LOOP.map(([title, detail]) => (
          <div key={title}>
            <strong>{title}</strong>
            <span>{detail}</span>
          </div>
        ))}
      </div>

      <section className="marketing-section" id="product">
        <div className="eyebrow">One connected record</div>
        <h2>
          From assignment to payment, keep every shoot, image, submission, and dollar in one place.
        </h2>
        <div className="feature-cards">
          <article className="feature-card">
            <span className="number">01</span>
            <h3>Operator OS</h3>
            <p>
              Work queue, shoot workspace, captions, dispatch, submissions, and the daily action
              path.
            </p>
          </article>
          <article className="feature-card">
            <span className="number">02</span>
            <h3>Revenue intelligence</h3>
            <p>
              Statements, receivables, splits, archive matches, buyer fit, and money that might
              otherwise disappear.
            </p>
          </article>
          <article className="feature-card">
            <span className="number">03</span>
            <h3>Rights control</h3>
            <p>
              Provenance, license context, monitored use, evidence, and accountable human review.
            </p>
          </article>
        </div>
      </section>

      <section className="marketing-section" id="sales">
        <div className="eyebrow">Sales engine</div>
        <h2>
          Mastline can help license the work—and participates only when it generates the license.
        </h2>
        <div className="pricing-note">
          <div>
            <strong>The photographer keeps {photographerShare}%.</strong>
            <p>
              Mastline receives {platformShare}% only on licenses generated inside Mastline. A sale
              you make through your own agency or buyer relationship carries no Mastline share at
              all. The subscription stands on its own.
            </p>
          </div>
          <Link className="button acid" href="/pricing">
            See the model
          </Link>
        </div>
      </section>

      <section className="marketing-section" id="rights">
        <div className="eyebrow">The larger purpose</div>
        <h2>Turn a stream of urgent moments into a durable commercial asset.</h2>
        <p className="muted">
          The product begins by helping photographers work faster. It earns the right to become
          infrastructure that gives independent visual journalists more ownership over the economics
          of their work.
        </p>
      </section>
    </main>
  );
}
