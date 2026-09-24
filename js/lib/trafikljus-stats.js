/**
 * TRAFIKLJUSSTATISTIK — delad mellan Läge 3 (js/modes/trafikljus.js)
 * och veckoarkivet (js/modes/statistik.js).
 *
 * Passtyper, veckosummering per typ och formattering. Typerna blandas
 * aldrig: datorer jämförs aldrig med övergångar. Veckan börjar måndag
 * 00:00 lokal tid (js/lib/week.js) — "Den här veckan" i Läge 3 och en
 * vald vecka i arkivet räknas med samma funktion.
 */

import { SUBJECTS } from "./color.js";
import { startOfWeek, inWeek } from "./week.js";

/** Passtyper. Gamla pass/config utan typ räknas som "overgang". */
export const KINDS = {
  overgang: { key: "overgang", label: "Övergång", icon: "signal",  defaults: { yellowSec: 60,  redSec: 120 } },
  datorer:  { key: "datorer",  label: "Datorer",  icon: "monitor", defaults: { yellowSec: 180, redSec: 300 } },
};
export const KIND_KEYS = Object.keys(KINDS);
export const DEFAULT_KIND = "overgang";

/** Giltig typnyckel (allt okänt/saknat → "overgang"). */
export const kindOf = (k) => (KINDS[k] ? k : DEFAULT_KIND);
/** Ett loggat pass typ — gamla pass utan `kind` är övergångar. */
export const sessionKind = (s) => kindOf(s?.kind);

/** Passets tidpunkt (startedAt, äldre dokument: createdAt). */
export const sessionTime = (s) => s?.startedAt ?? s?.createdAt ?? 0;

/**
 * Veckostatistik för EN passtyp ur loggade pass: antal per färg,
 * snabbaste gröna stopp (veckans rekord) och veckans pass nyast först.
 * Veckan är den som innehåller `now` — eller `weekStart` om den anges
 * (arkivet). `filter` (valfri) begränsar vidare, t.ex. till en lärare.
 */
export function computeStats(sessions, kind = DEFAULT_KIND, { now = Date.now(), weekStart = startOfWeek(now), filter = null } = {}) {
  const week = sessions
    .filter((s) => s.type === "trafikljus" && s.result && sessionKind(s) === kindOf(kind) &&
      inWeek(sessionTime(s), weekStart) && (!filter || filter(s)))
    .sort((a, b) => sessionTime(b) - sessionTime(a));

  const counts = { green: 0, yellow: 0, red: 0 };
  let recordSec = null;
  let recordId = null;
  for (const s of week) {
    const c = s.result.color;
    if (counts[c] != null) counts[c]++;
    if (c === "green" && (recordSec == null || s.result.durationSec < recordSec)) {
      recordSec = s.result.durationSec;
      recordId = s.id;
    }
  }

  return { counts, recordSec, recordId, latest: week, weekTotal: week.length };
}

/** "MM:SS" med GOLV (första sekunden visar 00:00 — räknar uppåt). */
export function fmtMMSS(ms) {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(m)}:${pad(s)}`;
}

/** "tis 10:15" inom innevarande vecka, annars "tis 15 sep 10:15". */
export function fmtWhen(ts, now = Date.now()) {
  const d = new Date(ts);
  const day = d.toLocaleDateString("sv-SE", { weekday: "short" }).replace(/\.$/, "");
  const time = d.toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" });
  if (inWeek(ts, startOfWeek(now))) return `${day} ${time}`;
  const date = d.toLocaleDateString("sv-SE", { day: "numeric", month: "short" }).replace(/\.$/, "");
  return `${day} ${date} ${time}`;
}

/** Lektionsnamn ur passets snapshot: blockets titel, annars ämnets namn. */
export function lessonLabel(lesson, subjects) {
  if (!lesson) return "";
  if (lesson.title) return lesson.title;
  return subjects.find((x) => x.id === lesson.subjectId)?.name ?? lesson.subjectId ?? "";
}

/** Inbyggda ämnen + klassens egna (settings/subjects, se Läge 2). */
export function mergedSubjects(settingsDocs) {
  const custom = settingsDocs.find((d) => d.id === "subjects")?.value?.list ?? [];
  const seen = new Set(SUBJECTS.map((s) => s.id));
  return [...SUBJECTS, ...custom.filter((s) => s?.id && !seen.has(s.id))];
}
