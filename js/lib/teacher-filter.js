/**
 * LÄRARFILTER — "Alla / Mina / en viss lärare" över attribuerade
 * dokument (pass, noteringar: createdBy/createdByName, se DATAMODELL.md).
 * Delas av Läge 3:s statistik och veckoarkivet under Statistik.
 *
 * Filtervärden: "all" | "mine" | "t:<uid>" | "unknown" (gamla dokument
 * utan attribution).
 */

import { currentUid } from "../data/plans.js";

const nameOf = (doc) => doc?.createdByName || "okänd lärare";

/** De ANDRA lärarna (inte den inloggade — "Mina" täcker den) som skapat
 *  något i docs, sorterade på namn, + "Okänd lärare" om det behövs. */
export function teacherOptions(docs) {
  const byUid = new Map();
  let unknown = false;
  for (const d of docs) {
    if (!d.createdBy) { unknown = true; continue; }
    if (!byUid.has(d.createdBy) || d.createdByName) byUid.set(d.createdBy, nameOf(d));
  }
  byUid.delete(currentUid());
  const opts = [...byUid]
    .sort((a, b) => a[1].localeCompare(b[1], "sv"))
    .map(([uid, name]) => ({ value: `t:${uid}`, name }));
  if (unknown) opts.push({ value: "unknown", name: "Okänd lärare" });
  return opts;
}

/** Predikat för ett filtervärde, eller null för "all" (inget filter). */
export function teacherFilterFn(value) {
  if (value === "mine") { const uid = currentUid(); return (d) => d.createdBy === uid; }
  if (value === "unknown") return (d) => !d.createdBy;
  if (value?.startsWith("t:")) { const uid = value.slice(2); return (d) => d.createdBy === uid; }
  return null;
}

/** Finns filtervärdet fortfarande bland alternativen? (annars → "all") */
export function validTeacherFilter(value, opts) {
  if (value === "all" || value === "mine") return value;
  return opts.some((o) => o.value === value) ? value : "all";
}
