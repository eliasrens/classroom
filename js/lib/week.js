/**
 * VECKOMATTE — gemensam veckologik för veckorytmen (issue #29).
 *
 * En vecka börjar måndag 00:00 LOKAL tid. "Rent varje måndag" betyder
 * att vyerna FILTRERAR på innevarande vecka — ingen data raderas; äldre
 * veckor visas i arkivet under Statistik (js/modes/statistik.js).
 *
 * Alla funktioner tar tiden som parameter (standard serverNow() — den
 * korrigerade klockan, js/lib/clock.js) så att de går att testa med falsk
 * klocka och räkna på valfri vecka.
 * Veckostegning går via Date#setDate — rätt även över sommartidsbyten
 * (en vecka är då inte exakt 7 × 24 h).
 */

import { serverNow } from "./clock.js";

const pad2 = (n) => String(n).padStart(2, "0");

/** Måndag 00:00 (lokal tid) för given tidpunkt — start på dess vecka. */
export function startOfWeek(now = serverNow()) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  const monday = (d.getDay() + 6) % 7; // mån = 0
  d.setDate(d.getDate() - monday);
  return d.getTime();
}

/** Veckostart n veckor från weekStart (negativt = bakåt). */
export function addWeeks(weekStart, n) {
  const d = new Date(weekStart);
  d.setDate(d.getDate() + 7 * n);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Ligger tidpunkten ts i veckan som börjar weekStart? */
export function inWeek(ts, weekStart) {
  return ts >= weekStart && ts < addWeeks(weekStart, 1);
}

/** ISO-8601-vecka { year, week } för en tidpunkt (lokal tid). */
export function isoWeek(ts = serverNow()) {
  const d = new Date(startOfWeek(ts));
  d.setDate(d.getDate() + 3); // veckans torsdag avgör året
  const year = d.getFullYear();
  const jan4 = new Date(year, 0, 4);
  const week = 1 + Math.round((startOfWeek(d.getTime()) - startOfWeek(jan4.getTime())) / (7 * 86_400_000));
  return { year, week };
}

/** Stabil veckonyckel, t.ex. "2026-W39" — används som dokument-id. */
export function weekKey(ts = serverNow()) {
  const { year, week } = isoWeek(ts);
  return `${year}-W${pad2(week)}`;
}

/** Veckostart (ms) för en veckonyckel, eller null om nyckeln är ogiltig. */
export function weekStartFromKey(key) {
  const m = /^(\d{4})-W(\d{2})$/.exec(String(key ?? ""));
  if (!m) return null;
  const week1 = startOfWeek(new Date(Number(m[1]), 0, 4).getTime());
  return addWeeks(week1, Number(m[2]) - 1);
}

/** "v.39" — med år om veckan tillhör ett annat (ISO-)år än nu. */
export function weekLabel(ts, now = serverNow()) {
  const { year, week } = isoWeek(ts);
  return year === isoWeek(now).year ? `v.${week}` : `v.${week} ${year}`;
}

/** "14–20 sep" eller "29 sep–5 okt" för veckan som börjar weekStart. */
export function weekRangeLabel(weekStart) {
  const a = new Date(weekStart);
  const b = new Date(addWeeks(weekStart, 1) - 1);
  const month = (d) => d.toLocaleDateString("sv-SE", { month: "short" }).replace(/\.$/, "");
  return a.getMonth() === b.getMonth()
    ? `${a.getDate()}–${b.getDate()} ${month(b)}`
    : `${a.getDate()} ${month(a)}–${b.getDate()} ${month(b)}`;
}
