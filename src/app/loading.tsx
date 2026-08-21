/**
 * The shape of a page while it loads.
 *
 * Deliberately matches the real layout -- a header block, a metrics strip, and
 * two panels -- so arriving content settles into place rather than shoving it.
 */
export default function Loading() {
  return (
    <div aria-busy="true" aria-live="polite" className="page skeleton-page">
      <span className="visually-hidden">Loading</span>
      <div className="skeleton skeleton-header" />
      <div className="skeleton-metrics">
        {[0, 1, 2, 3].map((index) => (
          <div className="skeleton skeleton-metric" key={index} />
        ))}
      </div>
      <div className="skeleton-grid">
        <div className="skeleton skeleton-panel" />
        <div className="skeleton skeleton-side" />
      </div>
    </div>
  );
}
