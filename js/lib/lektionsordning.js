/**
 * LEKTIONSORDNING I STUNDEN — bocka av steg + timer på pågående steg
 * (issue #146). Rena delar, testas i docs/test-lektionsordning.mjs; tavlan
 * och sidopanelens knappar ligger i js/modes/lektion.js. Byggt efter samma
 * mönster som "Efter rasten" (js/lib/efter-rasten.js).
 *
 * Data (planeringens `fields`, se DATAMODELL.md):
 *   ordningAktiv — index (0-baserat) för det pågående steget bland stegen
 *                  som visas på tavlan (attGora-raderna utan tomma rader),
 *                  eller null. Ett index utanför listan behandlas som null.
 *   ordningDatum — lektionsdagen (YYYY-MM-DD, lokal tid) då läget sattes.
 *   ordningTimer — { step, durationMs, startedAt } eller null. Om
 *                  step !== ordningAktiv behandlas timern som null.
 *
 * Läget gäller bara samma dag och tills planeringens sluttid passerats
 * (utan sluttid: resten av dagen). Ett läge som inte gäller längre ignoreras
 * vid rendering, och lärarvyn nollställer det (en gång, createOrdningReset).
 * Kopior får aldrig med läget (resetOrdningRun).
 *
 * Läraren styr allt: steget går aldrig vidare av sig självt, och vid 0 visar
 * timern bara "Klart".
 */

import { formatMs } from "./timer.js";
import { lessonStartMs } from "./efter-rasten.js";

export const STEP_MIN_MIN = 1;
export const STEP_MIN_MAX = 90;
/** Sidopanelens snabbknappar (minuter). */
export const STEP_QUICK_MIN = [5, 10, 15, 20];
export const STEP_DONE_TEXT = "Klart";
export const STEP_MIN_ERROR = `Ange ${STEP_MIN_MIN}–${STEP_MIN_MAX} minuter`;

const pad2 = (n) => String(n).padStart(2, "0");
const localISO = (now) => {
  const d = new Date(now);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};
const isIndex = (v) => Number.isInteger(v) && v >= 0;

/** Stegen som visas på tavlan (trimmade, utan tomma rader) — samma som stepsHTML. */
export function ordningSteps(fields) {
  const a = fields?.attGora;
  const rows = Array.isArray(a) ? a : (a ? String(a).split("\n") : []);
  return rows.map((s) => String(s ?? "").trim()).filter(Boolean);
}

/** Normaliserade fält (ur planeringens `fields`); saknat/trasigt → null. */
export function normalizeOrdningFields(f = {}) {
  const t = f.ordningTimer;
  const timer = t && isIndex(t.step) && Number.isFinite(t.durationMs) && t.durationMs > 0 && Number.isFinite(t.startedAt) && t.startedAt > 0
    ? { step: t.step, durationMs: t.durationMs, startedAt: t.startedAt }
    : null;
  return {
    ordningAktiv: isIndex(f.ordningAktiv) ? f.ordningAktiv : null,
    ordningDatum: /^\d{4}-\d{2}-\d{2}$/.test(String(f.ordningDatum ?? "")) ? f.ordningDatum : null,
    ordningTimer: timer,
  };
}

/**
 * Gäller läget just nu? Samma dag som det sattes, och planeringens sluttid
 * (den dagen) har inte passerats. Saknas sluttid gäller det resten av dagen.
 */
export function ordningLive(plan, now) {
  const f = normalizeOrdningFields(plan?.fields);
  if (f.ordningDatum !== localISO(now)) return false;
  const end = lessonStartMs(f.ordningDatum, plan?.end);
  return end == null || now < end;
}

/** Finns det något sparat läge alls (oavsett om det gäller)? */
const hasRun = (fields) => {
  const f = normalizeOrdningFields(fields);
  return f.ordningAktiv != null || f.ordningDatum != null || f.ordningTimer != null;
};

/**
 * Läget som gäller nu: { active, timer } — active = index eller null,
 * timer = { step, durationMs, startedAt } eller null. Ogiltigt eller
 * utgånget läge → { active: null, timer: null }.
 */
export function ordningState(plan, now) {
  const f = normalizeOrdningFields(plan?.fields);
  const n = ordningSteps(plan?.fields).length;
  if (f.ordningAktiv == null || f.ordningAktiv >= n || !ordningLive(plan, now)) return { active: null, timer: null };
  const timer = f.ordningTimer?.step === f.ordningAktiv ? f.ordningTimer : null;
  return { active: f.ordningAktiv, timer };
}

/**
 * Timern på det pågående steget: { phase, remainingMs, text }.
 *   none    — ingen timer (eller inget pågående steg)
 *   running — räknar ned (före startedAt, t.ex. klockskillnad: full tid)
 *   done    — tiden är ute: texten "Klart"
 */
export function stepCountdown(plan, now) {
  const { timer } = ordningState(plan, now);
  if (!timer) return { phase: "none", remainingMs: 0, text: "" };
  const left = Math.max(0, Math.min(timer.durationMs, timer.startedAt + timer.durationMs - now));
  return left > 0
    ? { phase: "running", remainingMs: left, text: formatMs(left) }
    : { phase: "done", remainingMs: 0, text: STEP_DONE_TEXT };
}

/* ---- Lärarens knappar: de ändrade fälten (sparas via datalagret) ---- */

/** Nästa steg: null → steg 1; från sista steget ingen effekt (null). Timern försvinner. */
export function stepNext(plan, now) {
  const n = ordningSteps(plan?.fields).length;
  const { active } = ordningState(plan, now);
  const next = active == null ? 0 : active + 1;
  if (n === 0 || next >= n) return null;
  return { ...plan.fields, ordningAktiv: next, ordningDatum: localISO(now), ordningTimer: null };
}

/** Föregående: steg 1 → null (dagens utseende); utan pågående steg ingen effekt (null). */
export function stepPrev(plan, now) {
  const { active } = ordningState(plan, now);
  if (active == null) return null;
  if (active === 0) return { ...plan.fields, ordningAktiv: null, ordningDatum: null, ordningTimer: null };
  return { ...plan.fields, ordningAktiv: active - 1, ordningDatum: localISO(now), ordningTimer: null };
}

/**
 * Minutfältet: heltal 1–90 → talet, annars null (tomt, 0, 91, text,
 * decimaltal). Felet visas vid fältet (STEP_MIN_ERROR).
 */
export function parseStepMinutes(v) {
  const s = String(v ?? "").trim();
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return n >= STEP_MIN_MIN && n <= STEP_MIN_MAX ? n : null;
}

/** Starta en timer på det pågående steget; utan pågående steg eller ogiltiga minuter → null. */
export function stepStartTimer(plan, minutes, now) {
  const { active } = ordningState(plan, now);
  const min = parseStepMinutes(minutes);
  if (active == null || min == null) return null;
  return { ...plan.fields, ordningTimer: { step: active, durationMs: min * 60_000, startedAt: now } };
}

/**
 * "+1 min": en minut till. Efter "Klart" räknar timern igen från 1:00.
 * Utan timer → null.
 */
export function stepPlusOneMinute(plan, now) {
  const { timer } = ordningState(plan, now);
  if (!timer) return null;
  const left = timer.startedAt + timer.durationMs - now;
  const next = left > 0
    ? { ...timer, durationMs: timer.durationMs + 60_000 }
    : { step: timer.step, durationMs: 60_000, startedAt: now };
  return { ...plan.fields, ordningTimer: next };
}

/** Stoppa timern — steget förblir markerat. */
export function stepStopTimer(plan) {
  return { ...plan.fields, ordningTimer: null };
}

/**
 * Inget körtillstånd (kopior, och lärarvyns nollställning efter lektionen).
 * Bara nycklar som finns sätts till null — gamla planeringar får inga nya.
 */
export function resetOrdningRun(fields) {
  const out = { ...fields };
  for (const k of ["ordningAktiv", "ordningDatum", "ordningTimer"]) if (k in out) out[k] = null;
  return out;
}

/** Finns ett sparat läge som inte gäller längre (annan dag, efter sluttiden)? */
export const ordningStale = (plan, now) => hasRun(plan?.fields) && !ordningLive(plan, now);

/**
 * Nollställningen efter lektionen — bara lärarvyn (`teacher`), bara EN gång
 * per planering och läge (svaret från datalagret dröjer ett ögonblick).
 * Returnerar check(plan, now) → true när nollställningen ska skrivas nu.
 */
export function createOrdningReset({ teacher = true } = {}) {
  const done = new Set();
  return (plan, now) => {
    if (!teacher || !plan?.id || !ordningStale(plan, now)) return false;
    const f = normalizeOrdningFields(plan.fields);
    const key = `${plan.id}|${f.ordningDatum}|${f.ordningAktiv}|${f.ordningTimer?.startedAt ?? ""}`;
    if (done.has(key)) return false;
    done.add(key);
    return true;
  };
}

/**
 * Det tavlan ska visa: null = inget markerat (exakt dagens tavla), annars
 * { active, phase, text } — phase/text från stepCountdown.
 */
export function ordningView(plan, now) {
  const { active } = ordningState(plan, now);
  if (active == null) return null;
  const c = stepCountdown(plan, now);
  return { active, phase: c.phase, text: c.text };
}
