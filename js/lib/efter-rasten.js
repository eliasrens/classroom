/**
 * "EFTER RASTEN" — rutan överst i lektionsplaneringens mittenkolumn
 * (issue #132). Rena delar, testas i docs/test-efter-rasten.mjs; tavlan
 * och knapparna ligger i js/modes/lektion.js.
 *
 * Data (planeringens `fields`, se DATAMODELL.md):
 *   efterRasten        — fritext, en rad per sak. Rader som börjar med
 *                        "-" (eller "•") blir punkter.
 *   efterRastenMin     — nedräkningens längd i minuter (1–60, standard 10)
 *   efterRastenPlusMin — "+1 min"-knappens tillägg (standard 0)
 *   efterRastenFrom    — epoch ms då nedräkningen startades om, eller null
 *                        = lektionens starttid. Sätts när läraren kryssar i
 *                        rutan igen efter att tiden redan gått ut.
 *   efterRastenOrd     — rubrikens ord, "rasten" | "pausen" (issue #139).
 *                        Saknat/okänt → "rasten".
 *
 * Nedräkningen byggs på js/lib/timer.js (tidsstämplar — rätt i
 * bakgrundsflikar och på elevskärmen); `now` skickas in (serverNow()).
 *   idle    — ingen starttid, eller planeringen gäller inte idag: full tid, står still
 *   waiting — före starttiden: full tid, står still
 *   running — räknar ned
 *   done    — tiden är ute: rutan tonas bort, lärarvyn bockar ur delen
 */

import { createTimerState, remainingMs, formatMs } from "./timer.js";

export const BREAK_MIN_DEFAULT = 10;
export const BREAK_MIN_MIN = 1;
export const BREAK_MIN_MAX = 60;

const esc = (s) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const pad2 = (n) => String(n).padStart(2, "0");
const localISO = (now) => {
  const d = new Date(now);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};

/** Minuter inom 1–60; ogiltigt → standard (10). */
export function clampBreakMinutes(v) {
  const n = Math.round(Number(v));
  if (v === "" || v == null || !Number.isFinite(n)) return BREAK_MIN_DEFAULT;
  return Math.min(BREAK_MIN_MAX, Math.max(BREAK_MIN_MIN, n));
}

/** Rubrikens ord (issue #139): "Efter rasten" eller "Efter pausen". Första = standard. */
export const BREAK_WORDS = ["rasten", "pausen"];

/** "rasten" | "pausen"; saknat/okänt → "rasten". */
export const breakWord = (v) => (BREAK_WORDS.includes(v) ? v : BREAK_WORDS[0]);

/** Rubriken, "Efter rasten" / "Efter pausen", ur planeringens `fields`. */
export const breakLabel = (fields) => `Efter ${breakWord(fields?.efterRastenOrd)}`;

/** Normaliserade fält för rutan (ur planeringens `fields`). */
export function normalizeBreakFields(f = {}) {
  const plus = Math.round(Number(f.efterRastenPlusMin));
  const from = Number(f.efterRastenFrom);
  return {
    efterRasten: Array.isArray(f.efterRasten) ? f.efterRasten.join("\n") : String(f.efterRasten ?? ""),
    efterRastenMin: clampBreakMinutes(f.efterRastenMin),
    efterRastenPlusMin: Number.isFinite(plus) && plus > 0 ? plus : 0,
    efterRastenFrom: f.efterRastenFrom != null && Number.isFinite(from) && from > 0 ? from : null,
    efterRastenOrd: breakWord(f.efterRastenOrd),
  };
}

const BULLET_RE = /^[-•]\s*/;

/**
 * Radtolkning: [{ kind: "list", items } | { kind: "text", text }].
 * Punktrader i följd hamnar i samma lista; tomma rader hoppas över men
 * avslutar en lista. Ett ensamt "-" blir ingenting.
 */
export function breakBlocks(text) {
  const out = [];
  for (const raw of String(text ?? "").split("\n")) {
    const line = raw.trim();
    if (!line) { out.push(null); continue; }
    if (BULLET_RE.test(line)) {
      const item = line.replace(BULLET_RE, "").trim();
      if (!item) continue;
      const last = out.at(-1);
      if (last?.kind === "list") last.items.push(item);
      else out.push({ kind: "list", items: [item] });
    } else {
      out.push({ kind: "text", text: line });
    }
  }
  return out.filter(Boolean);
}

/** Rutans innehåll som HTML (allt escapat). "" om det inte finns något. */
export function breakBodyHTML(text) {
  return breakBlocks(text).map((b) => b.kind === "list"
    ? `<ul class="lb-list lb-break__list">${b.items.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>`
    : `<p class="lb-break__text">${esc(b.text)}</p>`).join("");
}

/** Lektionens start som epoch ms (lokal tid), eller null. */
export function lessonStartMs(date, start) {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date ?? ""));
  const t = /^(\d{1,2}):(\d{2})$/.exec(String(start ?? "").trim());
  if (!d || !t || +t[1] > 23 || +t[2] > 59) return null;
  return new Date(+d[1], +d[2] - 1, +d[3], +t[1], +t[2]).getTime();
}

/** Nedräkningens längd i ms (minuter + "+1 min"-tillägg). */
export const breakDurationMs = (fields) => {
  const f = normalizeBreakFields(fields);
  return (f.efterRastenMin + f.efterRastenPlusMin) * 60_000;
};

/**
 * Timertillståndet (js/lib/timer.js) eller null när timern inte räknar
 * (ingen starttid, eller planeringen gäller inte idag).
 */
export function breakTimer(plan, now) {
  const f = normalizeBreakFields(plan?.fields);
  if (plan?.date !== localISO(now)) return null;
  const startedAt = f.efterRastenFrom ?? lessonStartMs(plan.date, plan.start);
  if (startedAt == null) return null;
  return createTimerState(breakDurationMs(f), startedAt);
}

/** { phase, remainingMs, endMs, text } — se huvudkommentaren. */
export function breakCountdown(plan, now) {
  const full = breakDurationMs(plan?.fields);
  const t = breakTimer(plan, now);
  if (!t) return { phase: "idle", remainingMs: full, endMs: null, text: formatMs(full) };
  const endMs = t.startedAt + t.durationMs;
  if (now < t.startedAt) return { phase: "waiting", remainingMs: full, endMs, text: formatMs(full) };
  const left = remainingMs(t, now);
  return { phase: left > 0 ? "running" : "done", remainingMs: left, endMs, text: formatMs(left) };
}

/** Ska rutan synas på tavlan just nu? (ikryssad och tiden inte ute) */
export const breakVisible = (plan, now) =>
  !!plan?.show?.efterRasten && breakCountdown(plan, now).phase !== "done";

/** "+1 min": de ändrade fälten (planeringens fields, sparas via datalagret). */
export function plusOneMinute(fields) {
  return { ...fields, efterRastenPlusMin: normalizeBreakFields(fields).efterRastenPlusMin + 1 };
}

/** En kopia (Kopiera / Skicka kopia) får rutans text och minuter, men inget körtillstånd. */
export function resetBreakRun(fields) {
  const out = { ...fields };
  if ("efterRastenPlusMin" in out) out.efterRastenPlusMin = 0;
  if ("efterRastenFrom" in out) out.efterRastenFrom = null;
  return out;
}

/**
 * Läraren kryssar i rutan: tillägget nollas. Har tiden redan gått ut
 * (samma dag) startar nedräkningen om från `now` — annars skulle rutan
 * försvinna och bockas ur direkt igen.
 */
export function enableBreakFields(plan, now) {
  const fields = { ...(plan?.fields ?? {}), efterRastenPlusMin: 0, efterRastenFrom: null };
  const done = breakCountdown({ ...plan, fields }, now).phase === "done";
  return done ? { ...fields, efterRastenFrom: now } : fields;
}

/**
 * Urbockningen när tiden är ute — bara lärarvyn, bara EN gång per
 * planering och nedräkning (svaret från datalagret dröjer ett ögonblick;
 * under tiden får ingen ny skrivning köas). Returnerar check(plan, now)
 * → true när urbockningen ska skrivas nu.
 */
export function createAutoHide() {
  const done = new Set();
  return (plan, now) => {
    if (!plan?.id || !plan.show?.efterRasten) return false;
    const c = breakCountdown(plan, now);
    if (c.phase !== "done") return false;
    const key = `${plan.id}|${c.endMs}`;
    if (done.has(key)) return false;
    done.add(key);
    return true;
  };
}
