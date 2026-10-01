/**
 * WIDGETS — ljudnivå, ren logik (issue #118). Delas av Ljudnivåskylten
 * (sound-sign.js) och Ljudmätaren (sound-meter.js). Ingen DOM, inga
 * webbläsar-API:er — testas i Node (docs/test-sound-level.mjs).
 *
 *  - Skyltens nivåer 0–4: namn (läraren kan byta), färg och symbolfärg.
 *  - Mätarens skala 0–1: RMS → dBFS → nivå (−60 dB = 0, −10 dB = 1).
 *  - Jämning: RMS som glidande medel över ett tidsfönster (0,5 s).
 *  - Zoner: grön / gul / röd runt gränsen för "för högt".
 *  - Kopplingen till skylten: tillåten nivå följer den valda nivån.
 *  - "För högt i N sekunder": lugnt rött först när nivån legat över
 *    gränsen i HOLD_MS, och tillbaka först när den legat under en lite
 *    lägre gräns i RELEASE_MS (hysteres — ingen blinkning kring gränsen).
 */

/** Skyltens nivåer. `ink` = symbolens färg på nivåfärgen. */
export const LEVELS = [
  { level: 0, name: "Tyst", color: "#5b7fd8", ink: "#ffffff" },
  { level: 1, name: "Viska", color: "#3aa56b", ink: "#ffffff" },
  { level: 2, name: "Prata lågt", color: "#e6c235", ink: "#2b2300" },
  { level: 3, name: "Prata", color: "#ee8b36", ink: "#2b1500" },
  { level: 4, name: "Redovisa", color: "#a466d6", ink: "#ffffff" },
];
export const DEFAULT_NAMES = LEVELS.map((l) => l.name);
/** Nivån som gäller innan läraren valt någon. */
export const DEFAULT_LEVEL = 1;
export const MAX_NAME_LENGTH = 24;

/** Heltal 0–4, eller DEFAULT_LEVEL för allt annat. */
export function clampLevel(v) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 0 && n < LEVELS.length && v !== null && v !== "" ? n : DEFAULT_LEVEL;
}

/** Skyltens fem namn: lärarens egna, tomt/trasigt → standardnamnet. */
export function normalizeNames(names) {
  const src = Array.isArray(names) ? names : [];
  return DEFAULT_NAMES.map((def, i) => {
    const s = typeof src[i] === "string" ? src[i].trim().slice(0, MAX_NAME_LENGTH) : "";
    return s || def;
  });
}

/** Den valda nivån ur skyltens körtillstånd ({ level }) — null/trasigt → DEFAULT_LEVEL. */
export const signLevelOf = (state) => clampLevel(state?.level);

// ---------------------------------------------------------------------------
// Mätarens skala
// ---------------------------------------------------------------------------

export const DB_FLOOR = -60;
export const DB_CEIL = -10;

/** Kvadratiskt medelvärde av samplen (−1…1). */
export function meanSquare(samples) {
  const n = samples?.length ?? 0;
  if (!n) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += samples[i] * samples[i];
  return sum / n;
}

export const rmsOf = (samples) => Math.sqrt(meanSquare(samples));

/** RMS (0–1) → mätarnivå 0–1 på en dB-skala (DB_FLOOR … DB_CEIL). */
export function levelFromRms(rms) {
  if (!(rms > 0)) return 0;
  const db = 20 * Math.log10(rms);
  return Math.min(1, Math.max(0, (db - DB_FLOOR) / (DB_CEIL - DB_FLOOR)));
}

/**
 * Glidande RMS: push(meanSquare, now) → RMS över de senaste `windowMs`.
 * Medlet tas på kvadraterna (energin), inte på RMS-värdena.
 */
export function createRmsSmoother({ windowMs = 500 } = {}) {
  let buf = []; // [{ at, ms }]
  return {
    push(ms, now) {
      buf.push({ at: now, ms: Number.isFinite(ms) && ms > 0 ? ms : 0 });
      const from = now - windowMs;
      while (buf.length > 1 && buf[0].at <= from) buf.shift();
      return this.value();
    },
    value() {
      if (!buf.length) return 0;
      return Math.sqrt(buf.reduce((s, x) => s + x.ms, 0) / buf.length);
    },
    reset() { buf = []; },
  };
}

// ---------------------------------------------------------------------------
// Gränsen och zonerna
// ---------------------------------------------------------------------------

/** Gränsen för "för högt" på mätarens skala, per skyltnivå (Tyst … Redovisa). */
export const SIGN_LIMITS = [0.3, 0.45, 0.6, 0.75, 0.9];
export const MIN_LIMIT = 0.1;
export const MAX_LIMIT = 0.95;
export const DEFAULT_LIMIT = 0.6;
/** Gult band under gränsen ("nära gränsen"). */
export const WARN_BAND = 0.15;

/** Reglagets värde: 0,1–0,95 i steg om 0,05; trasigt → DEFAULT_LIMIT. */
export function clampLimit(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || v === null || v === "") return DEFAULT_LIMIT;
  return Math.round(Math.min(MAX_LIMIT, Math.max(MIN_LIMIT, n)) * 20) / 20;
}

/** Gränsen för en skyltnivå. */
export const limitForSign = (level) => SIGN_LIMITS[clampLevel(level)];

/**
 * Gränsen som gäller: kopplad till skylten (och en skylt finns, signLevel
 * inte null) → skyltens nivå, annars reglaget.
 */
export function effectiveLimit(cfg, signLevel = null) {
  if (cfg?.linkSign && signLevel != null) return limitForSign(signLevel);
  return clampLimit(cfg?.limit);
}

/** Var gula zonen börjar. */
export const warnFrom = (limit) => Math.max(0, limit - WARN_BAND);

/** "green" | "yellow" | "red" för en (jämnad) nivå mot gränsen. */
export function zoneFor(level, limit) {
  if (level >= limit) return "red";
  if (level >= warnFrom(limit)) return "yellow";
  return "green";
}

// ---------------------------------------------------------------------------
// "För högt i N sekunder" — hysteres
// ---------------------------------------------------------------------------

export const HOLD_MS = 3000;
export const RELEASE_MS = 2000;
/** Nivån måste ner så här mycket under gränsen innan "för högt" släpper. */
export const RELEASE_MARGIN = 0.05;

/**
 * update(level, limit, now) → { zone, alert }. `alert` = lugnt rött: sant
 * först när nivån legat på/över gränsen i `holdMs` utan avbrott, och falskt
 * igen först när den legat under (gräns − releaseMargin) i `releaseMs`.
 * Tidsbaserad: samma anrop två gånger ger samma svar.
 */
export function createOverDetector({ holdMs = HOLD_MS, releaseMs = RELEASE_MS, releaseMargin = RELEASE_MARGIN } = {}) {
  let overSince = null;
  let underSince = null;
  let alert = false;
  return {
    update(level, limit, now) {
      if (level >= limit) {
        overSince ??= now;
        underSince = null;
        if (!alert && now - overSince >= holdMs) alert = true;
      } else {
        overSince = null;
        if (alert) {
          if (level < limit - releaseMargin) {
            underSince ??= now;
            if (now - underSince >= releaseMs) { alert = false; underSince = null; }
          } else {
            underSince = null;
          }
        }
      }
      return { zone: zoneFor(level, limit), alert };
    },
    get alert() { return alert; },
    reset() { overSince = null; underSince = null; alert = false; },
  };
}
