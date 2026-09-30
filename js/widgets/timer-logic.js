/**
 * TIMRAR — ren logik (issue #117). Ingen DOM, inget ljud: körs i Node
 * (docs/test-timers.mjs). Rendering och ton finns i timers.js / chime.js.
 *
 * Två typer:
 *   - "Kvar av lektionen" (time-left): nedräkning till en SLUTTID.
 *       lektionen → planeringens start/slut (plan.date/start/end),
 *       Morgonskärmen → lärarens klockslag (cfg.until, "HH:MM").
 *     Ingen körning att spara — tiden följer klockan (serverNow).
 *   - "Nedräkning" (countdown): minuter + sekunder, Start/Paus/Återställ.
 *     Körtillståndet är runtime-tidsstämplarna (js/widgets/runtime.js).
 *
 * Alla funktioner tar `now` (ms) och är rena.
 */

import { remainingMs as rtRemaining, isPaused } from "./runtime.js";

/** Analoga urtavlan visar högst så här mycket (en "Time Timer"). */
export const DIAL_MS = 60 * 60_000;
/** Så länge efter slutet pulserar widgeten (sedan bara färgmarkering). */
export const ALARM_MS = 60_000;
/** Tonen spelas bara om slutet är högst så här gammalt (omladdning senare → tyst). */
export const CHIME_WINDOW_MS = 15_000;
/** Lärarfönstret väntar så här länge på att elevskärmen tar tonen. */
export const CHIME_FALLBACK_MS = 1_500;

export const LOOKS = ["digits", "bar", "analog"];
export const LOOK_LABELS = { digits: "Siffror", bar: "Stapel", analog: "Analog klocktimer" };

/** Längsta nedräkning (minuter). */
export const MAX_MINUTES = 180;

const clampInt = (v, lo, hi, dflt) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
};

/** "HH:MM" → minuter efter midnatt, eller null. */
export function parseHM(s) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s ?? "").trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

const pad2 = (n) => String(n).padStart(2, "0");

/** "YYYY-MM-DD" för den lokala dagen `now`. */
export function localISO(now) {
  const d = new Date(now);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** ms för klockslaget `minutes` (efter midnatt) samma lokala dag som `now`. */
function atMinutes(now, minutes) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setMinutes(minutes);
  return d.getTime();
}

// ---------------------------------------------------------------------------
// Inställningar
// ---------------------------------------------------------------------------

export const normalizeLook = (v) => (LOOKS.includes(v) ? v : "digits");

export function normalizeTimeLeftCfg(cfg = {}) {
  return {
    look: normalizeLook(cfg.look),
    sound: cfg.sound === true, // AV från början
    until: parseHM(cfg.until) == null ? "" : String(cfg.until).trim().padStart(5, "0"), // bara Morgonskärmen
  };
}

export function normalizeCountdownCfg(cfg = {}) {
  let minutes = clampInt(cfg.minutes, 0, MAX_MINUTES, 5);
  let seconds = clampInt(cfg.seconds, 0, 59, 0);
  if (minutes === MAX_MINUTES) seconds = 0;
  if (minutes === 0 && seconds === 0) minutes = 1; // en nedräkning på 0 s är ingen nedräkning
  return {
    title: typeof cfg.title === "string" ? cfg.title.slice(0, 60) : "", // tom från början
    minutes,
    seconds,
    look: normalizeLook(cfg.look),
    sound: cfg.sound === true,
  };
}

export const countdownDurationMs = (cfg) => (cfg.minutes * 60 + cfg.seconds) * 1000;

// ---------------------------------------------------------------------------
// Vad en timer visar just nu — en "vy" som renderingen bara ritar ut.
//
//   {
//     status: "idle" | "running" | "paused" | "before" | "later" | "done" | "none",
//     remainingMs,   // kvar till slutet (0 när slut)
//     fraction,      // stapeln: andel kvar 0–1
//     dial,          // urtavlan: andel av 60 min 0–1
//     endMs,         // när tiden tar slut (null om okänt/pausad) — för tonen
//     alarm,         // pulsera (slutet är nyss)
//     text,          // siffrorna: "4:59" / "Slut" / "Börjar om 5 min"
//     label,         // kort rad: "Tiden är ute" / "Pausad" / ""
//   }
// ---------------------------------------------------------------------------

/** "mm:ss" (h:mm:ss över en timme). Avrundar uppåt: 0,2 s kvar visas som 0:01. */
export function formatRemaining(ms) {
  const total = Math.ceil(Math.max(0, ms) / 1000);
  const s = total % 60;
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);
  return h > 0 ? `${h}:${pad2(m)}:${pad2(s)}` : `${m}:${pad2(s)}`;
}

const dialOf = (ms) => Math.min(1, Math.max(0, ms / DIAL_MS));

function doneView(endMs, now, text) {
  return {
    status: "done", remainingMs: 0, fraction: 0, dial: 0, endMs,
    alarm: endMs != null && now - endMs < ALARM_MS,
    text, label: "Tiden är ute",
  };
}

/** "Börjar om 5 min" / "Börjar kl. 13:10" (mer än en timme kvar). */
function startsText(startMs, now) {
  const min = Math.ceil((startMs - now) / 60_000);
  if (min <= 60) return `Börjar om ${Math.max(1, min)} min`;
  const d = new Date(startMs);
  return `Börjar kl. ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

const DAYS = ["sön", "mån", "tis", "ons", "tor", "fre", "lör"];

/**
 * "Kvar av lektionen" i lektionen. `lesson` = { date, start, end } ur
 * planeringen. Planering för en annan dag: senare → "Börjar tor 2/10",
 * tidigare → "Slut" (ingen puls, ingen ton).
 */
export function lessonLeftView(lesson, now) {
  const end = parseHM(lesson?.end);
  if (end == null) return { status: "none", remainingMs: 0, fraction: 1, dial: 0, endMs: null, alarm: false, text: "Ingen sluttid", label: "" };
  let start = parseHM(lesson?.start);
  if (start != null && start >= end) start = null;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(lesson?.date ?? "") ? lesson.date : null;
  const today = localISO(now);
  if (date && date < today) {
    return { status: "done", remainingMs: 0, fraction: 0, dial: 0, endMs: null, alarm: false, text: "Slut", label: "" };
  }
  if (date && date > today) {
    const [y, m, d] = date.split("-").map(Number);
    const day = new Date(y, m - 1, d);
    return { status: "later", remainingMs: 0, fraction: 1, dial: 0, endMs: null, alarm: false, text: `Börjar ${DAYS[day.getDay()]} ${d}/${m}`, label: "" };
  }
  const endMs = atMinutes(now, end);
  const startMs = start == null ? null : atMinutes(now, start);
  if (startMs != null && now < startMs) {
    const len = endMs - startMs;
    return { status: "before", remainingMs: len, fraction: 1, dial: dialOf(len), endMs, alarm: false, text: startsText(startMs, now), label: "" };
  }
  if (now >= endMs) return doneView(endMs, now, "Slut");
  const left = endMs - now;
  const fraction = startMs != null ? left / (endMs - startMs) : dialOf(left);
  return { status: "running", remainingMs: left, fraction, dial: dialOf(left), endMs, alarm: false, text: formatRemaining(left), label: "" };
}

/**
 * "Kvar av lektionen" på Morgonskärmen: nedräkning till lärarens klockslag
 * i dag. Stapeln mäts mot en timme (som urtavlan). Nästa dag börjar den om.
 */
export function untilView(until, now) {
  const end = parseHM(until);
  if (end == null) return { status: "none", remainingMs: 0, fraction: 1, dial: 0, endMs: null, alarm: false, text: "–", label: "Välj klockslag" };
  const endMs = atMinutes(now, end);
  if (now >= endMs) return doneView(endMs, now, "Slut");
  const left = endMs - now;
  return { status: "running", remainingMs: left, fraction: dialOf(left), dial: dialOf(left), endMs, alarm: false, text: formatRemaining(left), label: "" };
}

/**
 * Nedräkningen. `state` = runtime-tillståndet ({ durationMs, startedAt,
 * pausedAt, endsAt } eller null = inte startad → visar inställd längd).
 */
export function countdownView(cfg, state, now) {
  const set = countdownDurationMs(cfg);
  if (!state || !Number.isFinite(state.durationMs)) {
    return { status: "idle", remainingMs: set, fraction: 1, dial: dialOf(set), endMs: null, alarm: false, text: formatRemaining(set), label: "" };
  }
  const left = rtRemaining(state, now);
  const total = state.durationMs || 1;
  if (left <= 0) {
    const endMs = state.endsAt ?? state.startedAt + state.durationMs;
    return doneView(endMs, now, "0:00");
  }
  const paused = isPaused(state);
  return {
    status: paused ? "paused" : "running",
    remainingMs: left,
    fraction: left / total,
    dial: dialOf(left),
    endMs: paused ? null : state.endsAt ?? state.startedAt + state.durationMs,
    alarm: false,
    text: formatRemaining(left),
    label: paused ? "Pausad" : "",
  };
}

// ---------------------------------------------------------------------------
// Urtavlan — SVG-väg för den röda tårtbiten (viewBox 0 0 100 100).
// Tårtbiten börjar vid 12 och sträcker sig MOTURS lika många minuter som är
// kvar; när tiden går flyttas kanten medurs mot 0 (som en "Time Timer").
// ---------------------------------------------------------------------------

export function piePath(dial, r = 46, cx = 50, cy = 50) {
  const f = Math.min(1, Math.max(0, Number(dial) || 0));
  if (f <= 0) return "";
  if (f >= 0.9999) {
    return `M${cx} ${cy - r}A${r} ${r} 0 1 0 ${cx} ${cy + r}A${r} ${r} 0 1 0 ${cx} ${cy - r}Z`;
  }
  const a = f * 2 * Math.PI;
  const x = cx - r * Math.sin(a);
  const y = cy - r * Math.cos(a);
  const large = f > 0.5 ? 1 : 0;
  return `M${cx} ${cy}L${cx} ${cy - r}A${r} ${r} 0 ${large} 0 ${x.toFixed(3)} ${y.toFixed(3)}Z`;
}

// ---------------------------------------------------------------------------
// Tonen — spelas i EXAKT ETT fönster, en gång per slut.
//
// Roll per fönster:
//   "never"    — lärarens inbäddade förhandsvisning av elevskärmen
//   "student"  — elevskärmen: spelar direkt om den får spela ljud
//                (webbläsaren kräver ett klick i fönstret först); annars
//                lämnar den tonen åt lärarfönstret
//   "teacher"  — lärarfönstret när ingen elevskärm är öppen: spelar direkt
//   "fallback" — lärarfönstret medan en elevskärm är öppen: väntar
//                CHIME_FALLBACK_MS och spelar bara om ingen annan tagit tonen
//                (elevskärmen visar kanske ett annat läge, eller är tyst)
//
// "Tagen" = en lokal nyckel per widget med slutets tidsstämpel. Samma
// localStorage för alla fönster → den som tar den först spelar; en
// omladdning ser att tonen redan spelats; en ny körning (nytt slut) får en
// egen ton.
// ---------------------------------------------------------------------------

export const chimeKey = (classId, widgetId) => `classroom:local:widgets-chime/${classId ?? "_"}/${widgetId}`;

export function chimeRole({ view, preview = false, studentOpen = false }) {
  if (preview) return "never";
  if (view === "student") return "student";
  return studentOpen ? "fallback" : "teacher";
}

/**
 * Ett steg i ett fönsters beslut: "play" (ta tonen och spela), "wait"
 * (fråga igen vid nästa tick) eller "skip" (inte det här fönstret / inte nu).
 * `claimed` = tonen för just det här slutet är redan tagen.
 * `audioReady` = fönstret får spela ljud.
 */
export function chimeStep({ sound, endMs, now, role, audioReady, claimed }) {
  if (!sound || endMs == null || role === "never" || claimed) return "skip";
  if (now < endMs) return "wait";
  if (now - endMs > CHIME_WINDOW_MS) return "skip";
  if (role === "fallback") return now - endMs >= CHIME_FALLBACK_MS ? "play" : "wait";
  if (role === "student" && !audioReady) return "wait";
  return "play";
}

/** Är tonen för `endMs` redan tagen? */
export function chimeClaimed(storage, key, endMs) {
  try { return storage?.getItem(key) === String(endMs); } catch { return false; }
}

/** Ta tonen. → true om det här fönstret fick den (ingen annan hann före). */
export function claimChime(storage, key, endMs) {
  try {
    if (!storage || storage.getItem(key) === String(endMs)) return false;
    storage.setItem(key, String(endMs));
    return true;
  } catch { return false; }
}
