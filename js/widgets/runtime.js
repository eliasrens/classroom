/**
 * WIDGETS — körtillstånd (issue #115).
 *
 * Timrarnas körning (start, paus, sluttid) och ljudnivåskyltens valda nivå
 * är INTE inställningar: de ändras under lektionen, gäller den här datorn
 * och ska aldrig till molnet. De lagras lokalt, en nyckel per klass och
 * widget-id:
 *
 *   classroom:local:widgets/{classId}/{widgetId}  →  JSON-objekt
 *
 * Synk mellan lärarfönster och elevfönster (samma webbläsare) sker via
 * storage-eventet (docs/SYNC.md): en skrivning här syns direkt i alla
 * andra fönster, och i det egna fönstret via en intern lyssnarlista.
 * Tillståndet är TIDSSTÄMPLAR, aldrig en tickande räknare — båda
 * fönstren räknar själva ut samma tid ur samma stämplar (serverNow,
 * js/lib/clock.js), så de visar alltid samma sak.
 *
 * Timertillstånd (bygger på js/lib/timer.js):
 *   { durationMs, startedAt, pausedAt, endsAt }
 *   pausedAt = null när den går; endsAt = sluttiden när den går, annars null.
 *
 * Ren logik + localStorage — ingen DOM. Körs i Node med en attrapp för
 * localStorage (docs/test-widgets.mjs).
 */

import { serverNow } from "../lib/clock.js";
import * as timer from "../lib/timer.js";

const PREFIX = "classroom:local:widgets/";

/** localStorage-nyckeln för en widgets körtillstånd. */
export const runtimeKey = (classId, widgetId) => `${PREFIX}${classId ?? "_"}/${widgetId}`;

const listeners = new Map(); // key → Set<cb>

function storage() {
  try { return globalThis.localStorage ?? null; } catch { return null; }
}

/** Körtillståndet (objekt) eller null om inget finns. */
export function readRuntime(classId, widgetId) {
  try {
    const raw = storage()?.getItem(runtimeKey(classId, widgetId));
    const v = raw ? JSON.parse(raw) : null;
    return v && typeof v === "object" ? v : null;
  } catch { return null; }
}

function notify(key, value) {
  for (const cb of listeners.get(key) ?? []) {
    try { cb(value); } catch (err) { console.warn("[widgets/runtime] lyssnare:", err); }
  }
}

/**
 * Spara körtillståndet (null = ta bort). Stämplas med updatedAt.
 * Andra fönster får det via storage-eventet, det egna via lyssnarna.
 */
export function writeRuntime(classId, widgetId, state, now = serverNow()) {
  const key = runtimeKey(classId, widgetId);
  const value = state == null ? null : { ...state, updatedAt: now };
  try {
    if (value == null) storage()?.removeItem(key);
    else storage()?.setItem(key, JSON.stringify(value));
  } catch (err) {
    console.warn("[widgets/runtime] kunde inte spara:", err);
  }
  notify(key, value);
  return value;
}

export const clearRuntime = (classId, widgetId) => writeRuntime(classId, widgetId, null);

/**
 * Lyssna på en widgets körtillstånd — ändringar från det här fönstret och
 * (via storage-eventet) från alla andra. cb(state | null). → unsubscribe.
 */
export function watchRuntime(classId, widgetId, cb) {
  const key = runtimeKey(classId, widgetId);
  if (!listeners.has(key)) listeners.set(key, new Set());
  listeners.get(key).add(cb);
  const onStorage = (e) => {
    if (e.key !== key && e.key !== null) return; // null = localStorage.clear()
    cb(readRuntime(classId, widgetId));
  };
  globalThis.addEventListener?.("storage", onStorage);
  return () => {
    listeners.get(key)?.delete(cb);
    globalThis.removeEventListener?.("storage", onStorage);
  };
}

// ---------------------------------------------------------------------------
// Timertillstånd på tidsstämplar (rena funktioner, `now` kan skickas in).
// ---------------------------------------------------------------------------

const withEnds = (s) => (s ? { ...s, endsAt: s.pausedAt == null ? s.startedAt + s.durationMs : null } : s);

/** Ny timer som går från `now`. */
export function startTimer(durationMs, now = serverNow()) {
  return withEnds(timer.createTimerState(Math.max(0, Number(durationMs) || 0), now));
}
/** Pausa (no-op om redan pausad). */
export const pauseTimer = (state, now = serverNow()) => withEnds(timer.pauseTimer(state, now));
/** Fortsätt (no-op om den går). Pausen räknas inte som förfluten tid. */
export const resumeTimer = (state, now = serverNow()) => withEnds(timer.resumeTimer(state, now));
/** Lägg till / dra ifrån tid. */
export const adjustTimer = (state, deltaMs, now = serverNow()) => withEnds(timer.adjustTimer(state, deltaMs, now));
/** Millisekunder kvar (aldrig negativt). */
export const remainingMs = (state, now = serverNow()) => timer.remainingMs(state, now);
export const isFinished = (state, now = serverNow()) => timer.isFinished(state, now);
export const isPaused = (state) => state != null && state.pausedAt != null;
export const isRunning = (state, now = serverNow()) => state != null && state.pausedAt == null && !isFinished(state, now);
export const formatMs = timer.formatMs;
