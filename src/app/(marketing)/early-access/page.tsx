import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Start free" };

export default function Page() {
  return (
    <>
      <section className="pagehead">
        <div className="wrap">
          <div className="crumb">
            <Link href="/">Home</Link> / Start free
          </div>
          <h1>Run the business behind every image.</h1>
          <p className="lede">
            Thirty days free on any plan, no card required. Tell us a little about how you work and
            your workspace will be ready in minutes.
          </p>
        </div>
      </section>

      <section>
        <div className="wrap">
          <form
            className="form"
            action="mailto:hello@mastline.co"
            method="post"
            encType="text/plain"
          >
            <label>
              Name
              <input type="text" name="name" placeholder="Your name" />
            </label>
            <label>
              Email
              <input type="email" name="email" placeholder="you@example.com" />
            </label>
            <label>
              City or market
              <input type="text" name="market" placeholder="Los Angeles, London, New York…" />
            </label>
            <label>
              How you work
              <select name="setup">
                <option>Independent photographer</option>
                <option>Team of 2–10</option>
                <option>Boutique agency</option>
                <option>Other</option>
              </select>
            </label>
            <label className="full">
              What slows you down today?
              <textarea
                name="pain"
                placeholder="Pitching, captions, chasing payment, archive, rights…"
              ></textarea>
            </label>
            <div
              className="full"
              style={{ display: "flex", alignItems: "center", gap: "16px", flexWrap: "wrap" }}
            >
              <button className="btn primary" type="submit">
                Create my workspace
              </button>
              <span className="note">
                No card to start. We rarely email, and when we do it&apos;s a field guide, a new
                feature, or something else worth your time.
              </span>
            </div>
          </form>
        </div>
      </section>
    </>
  );
}
