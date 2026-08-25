/**
 * Local-clock and coordinate helpers for forms that open with a default.
 *
 * Both are pure so they can be tested without a browser, and both produce a
 * value the operator is expected to overwrite. A default is a starting point,
 * never an assertion: the shoot brief is a human record, and a wrong time or
 * place inherited by every asset is worse than an empty field.
 */

/**
 * A `datetime-local` value for a moment, in the viewer's own clock.
 *
 * `toISOString()` would be UTC and would show the wrong wall time to anyone
 * outside it, so the parts are read locally and assembled by hand. The control
 * takes minutes, so seconds are dropped.
 */
export function toDatetimeLocalValue(date: Date): string {
  if (Number.isNaN(date.getTime())) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

/**
 * How precisely a device fix is written into a location field.
 *
 * Four decimal places is roughly eleven metres, which names a doorway without
 * pretending to name a person's exact position. A shoot location is inherited
 * by every asset and can travel to a buyer, so this rounds rather than storing
 * whatever precision the handset reported.
 */
export const COORDINATE_PLACES = 4;

export function formatCoordinates(latitude: number, longitude: number): string {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return "";
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return "";
  return `${latitude.toFixed(COORDINATE_PLACES)}, ${longitude.toFixed(COORDINATE_PLACES)}`;
}
