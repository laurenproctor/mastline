import Link from "next/link";

export default function NotFound() {
  return (
    <main className="marketing">
      <section className="marketing-section">
        <div className="eyebrow">Not found</div>
        <h2>That record does not exist in this workspace.</h2>
        <p className="muted">
          It may have been archived, moved to another workspace, or never created.
        </p>
        <div className="hero-actions">
          <Link className="button blue" href="/work">
            Back to the work queue
          </Link>
          <Link className="button" href="/archive">
            Search the archive
          </Link>
        </div>
      </section>
    </main>
  );
}
