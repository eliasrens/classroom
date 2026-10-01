/**
 * WIDGETS — delat för klockorna (issue #116): Klocka (digital) och
 * Klocka (analog).
 *
 *  - createClockTicker: ritsignal PRECIS vid varje sekund- eller
 *    minutskifte enligt serverNow() (js/lib/clock.js). En fast setInterval
 *    på 1000 ms glider mot sekundskiftet och visar ibland samma sekund två
 *    gånger och hoppar över nästa; här räknas varje väntan om från klockan,
 *    så den rättar sig själv (även när offseten kalibreras om).
 *  - Svenska datum utan Intl ("tisdag 29 september") — samma resultat i
 *    alla webbläsare och i Node (docs/test-clock-widgets.mjs).
 *  - Kryssrutor för typernas av/på-inställningar (settingsHTML/bindSettings).
 */

import { serverNow, onClockChange } from "../lib/clock.js";

export const pad2 = (n) => String(n).padStart(2, "0");

const WEEKDAYS = ["söndag", "måndag", "tisdag", "onsdag", "torsdag", "fredag", "lördag"];
const MONTHS = ["januari", "februari", "mars", "april", "maj", "juni", "juli",
  "augusti", "september", "oktober", "november", "december"];

/** "tisdag 29 september" (lokal tid) för tidpunkten `now`. */
export function formatDate(now = serverNow()) {
  const d = new Date(now);
  return `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/** "YYYY-MM-DD" för <time datetime>. */
export function isoDate(now = serverNow()) {
  const d = new Date(now);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Millisekunder till nästa skifte av `periodMs` (i (0, periodMs]). */
export function msToNextTick(now, periodMs) {
  const into = ((now % periodMs) + periodMs) % periodMs;
  return periodMs - into;
}

// Vänta en aning förbi skiftet, så att tiden garanterat har bytts när vi ritar.
const SLACK_MS = 20;

/**
 * Anropar onTick(now) direkt, sedan vid varje sekund- (periodMs 1000) eller
 * minutskifte (60 000), när fliken blir synlig igen och när klockan
 * kalibrerats om. → stop(). Efter stop() finns inga timrar eller lyssnare kvar.
 *
 * `el` (valfri): stoppa av sig självt om elementet tagits bort ur dokumentet
 * utan destroy — en bortglömd städning ska aldrig lämna en klocka som tickar.
 */
export function createClockTicker(onTick, { periodMs = 1000, now = serverNow, el = null } = {}) {
  let timer = null;
  let stopped = false;
  let wasConnected = false;

  const tick = () => {
    if (stopped) return;
    if (el) {
      if (el.isConnected) wasConnected = true;
      else if (wasConnected) { stop(); return; }
    }
    try { onTick(now()); } catch (err) { console.warn("[klocka] tick:", err); }
  };
  const schedule = () => {
    clearTimeout(timer);
    timer = null;
    if (stopped) return;
    timer = setTimeout(() => { timer = null; tick(); schedule(); }, msToNextTick(now(), periodMs) + SLACK_MS);
  };
  const refresh = () => { tick(); schedule(); };
  const hasDoc = typeof document !== "undefined";
  const onVisible = () => { if (!document.hidden) refresh(); };
  if (hasDoc) document.addEventListener("visibilitychange", onVisible);
  const offClock = onClockChange(refresh);

  function stop() {
    if (stopped) return;
    stopped = true;
    clearTimeout(timer);
    timer = null;
    if (hasDoc) document.removeEventListener("visibilitychange", onVisible);
    offClock();
  }

  refresh();
  return stop;
}

// ---------------------------------------------------------------------------
// Av/på-inställningar
// ---------------------------------------------------------------------------

const esc = (s) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/** Kryssrutor för `options` = [{ key, label }] med värdena i cfg. */
export function togglesHTML(options, cfg) {
  return `<div class="wopts">${options.map((o) => `<label class="wopt">
    <input type="checkbox" data-wopt="${esc(o.key)}"${cfg[o.key] ? " checked" : ""}>
    <span>${esc(o.label)}</span>
  </label>`).join("")}</div>`;
}

/** Kopplar kryssrutorna från togglesHTML: onChange(nyCfg) vid varje ändring. → cleanup. */
export function bindToggles(root, cfg, onChange) {
  let cur = { ...cfg };
  const handler = (e) => {
    const key = e.target?.dataset?.wopt;
    if (!key) return;
    cur = { ...cur, [key]: e.target.checked };
    onChange(cur);
  };
  root.addEventListener("change", handler);
  return () => root.removeEventListener("change", handler);
}
