/**
 * Calendar dates for the Tracker's date pickers.
 *
 * Local on purpose. The date inputs show local dates and the server's
 * parseRange reads "YYYY-MM-DD" as local midnight, so the string has to be the
 * local calendar date. toISOString().slice(0, 10) gives the UTC date instead,
 * which in Sydney is a day early until mid-morning: the tracking window's start
 * (3/1 local, stored as 2/28 13:00 UTC) showed as 2/28, and "today" showed as
 * yesterday every morning.
 */
export function isoDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function monthsAgo(n: number, now: Date = new Date()): Date {
  const d = new Date(now);
  d.setMonth(d.getMonth() - n);
  return d;
}

/**
 * Where a Reset starts unless the user types another date: the window already
 * being tracked, when there is one.
 *
 * The old default was six months back regardless, so accepting it silently
 * shrank the window — on 2026-09-20 that would have deleted 265 emails and
 * seven whole cards from before 3/20. A default must not narrow what is
 * already tracked. Narrowing it on purpose (to start from 5/1, say) stays one
 * edit away.
 */
export function defaultResetStart(
  windowStart: string | null,
  now: Date = new Date()
): string {
  return windowStart ? isoDate(new Date(windowStart)) : isoDate(monthsAgo(6, now));
}
