/**
 * KORRIGERAD KLOCKA (issue #31) — servertid som sanning.
 *
 * Lärardatorer har ibland fel klocka. Datalagret löser konflikter med
 * last-write-wins på `updatedAt`, så en enhet vars klocka går FÖRE skulle
 * annars kunna låsa ett delat dokument för alla tills realtiden hunnit
 * ikapp (hänt: 4A:s settings/morningScreen fick updatedAt fyra dagar fram).
 *
 *   serverNow()  = Date.now() + offset
 *
 * Offseten mäts mot Firestore (firestore-sync.js calibrate(): skriver
 * serverTimestamp() och läser tillbaka) och delas mellan fönster via
 * localStorage. Innan den mätts (t.ex. offline) är offset 0 = lokal tid,
 * och då skyddar klämreglerna nedan i stället.
 *
 * Klämreglerna (används i datalayer.js mergeRemote och firestore-sync.js
 * push):
 *   - isFutureStamp(t): t ligger mer än FUTURE_TOLERANCE_MS efter
 *     serverNow() — skrivet av en enhet med fel klocka. Ett sådant
 *     `updatedAt` får aldrig vinna mot en riktig ändring.
 *   - clampStamp(t): framtida tidsstämpel → serverNow() ("nu"). Används
 *     när en egen op skrivs till servern, så en falsk tid aldrig når molnet.
 *
 * Modulen rör inte DOM och tål att köras i Node (docs/test-clock.mjs).
 */

/** Så mycket får en tidsstämpel ligga före servertiden innan den räknas som fel. */
export const FUTURE_TOLERANCE_MS = 5 * 60_000;
/** Från den här avvikelsen varnar lärarvyn för datorns klocka. */
export const CLOCK_WARN_MS = 2 * 60_000;

const STORAGE_KEY = "classroom:clockOffset";
// En sparad offset (annat fönster, tidigare sidladdning) används bara om den
// ser färsk ut: servertiden den ger ska ligga 0–12 h efter mätningen. Har
// datorns klocka ställts om mer än så sedan dess stämmer den inte längre.
const STORED_MAX_AGE_MS = 12 * 3_600_000;

let offset = 0;
let calibrated = false;
const listeners = new Set();

/** Nu enligt servern (bästa uppskattning). Lokal tid tills offseten mätts. */
export function serverNow() {
  return Date.now() + offset;
}

/** Är klockan kalibrerad mot servern i den här sessionen (eller nyss i ett annat fönster)? */
export function clockCalibrated() {
  return calibrated;
}

/** { calibrated, offset } — offset = servertid − lokal tid (ms). */
export function clockState() {
  return { calibrated, offset };
}

/** Prenumerera på kalibreringar. Returnerar unsubscribe. */
export function onClockChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function apply(next, { persist }) {
  offset = next;
  calibrated = true;
  if (persist) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ offset: next, at: serverNow() }));
    } catch { /* lagring otillgänglig — gäller bara det här fönstret */ }
  }
  for (const fn of listeners) {
    try { fn(clockState()); } catch (err) { console.warn("[klocka] lyssnare:", err); }
  }
}

/** Ny mätning: servertid − lokal tid (ms). Sparas och delas med andra fönster. */
export function setServerOffset(ms) {
  if (!Number.isFinite(ms)) return;
  apply(Math.round(ms), { persist: true });
}

function adoptStored(raw) {
  try {
    const s = JSON.parse(raw);
    if (!Number.isFinite(s?.offset) || !Number.isFinite(s?.at)) return;
    const age = Date.now() + s.offset - s.at;
    if (age >= -60_000 && age < STORED_MAX_AGE_MS) apply(s.offset, { persist: false });
  } catch { /* trasigt värde — ignorera */ }
}

/** Ligger tidsstämpeln t orimligt långt fram (fel klocka på någon enhet)? */
export function isFutureStamp(t, now = serverNow()) {
  return typeof t === "number" && t > now + FUTURE_TOLERANCE_MS;
}

/** Framtida tidsstämpel → nu; annars oförändrad. */
export function clampStamp(t, now = serverNow()) {
  return isFutureStamp(t, now) ? now : t;
}

/** Kopia av doc med updatedAt/createdAt klämda till högst "nu". */
export function clampDocStamps(doc, now = serverNow()) {
  if (!doc) return doc;
  const out = { ...doc };
  if (isFutureStamp(out.updatedAt, now)) out.updatedAt = now;
  if (isFutureStamp(out.createdAt, now)) out.createdAt = Math.min(now, out.updatedAt ?? now);
  return out;
}

/**
 * Ska fjärrversionen ersätta den lokala? Last-write-wins på updatedAt, med
 * skydd mot framtida tidsstämplar:
 *  - Är EXAKT EN av dem framtida gäller servern — om inte den lokala
 *    versionen är en egen, ännu ej pushad ändring (då vinner den, och
 *    pushen skriver den till servern med korrekt tid).
 *  - Annars vanlig LWW (lika = fjärr vinner).
 * Samma regel på alla enheter och samma serverdata ⇒ samma resultat:
 * när outboxen är tom hamnar alla på serverns version (ingen divergens).
 * pending: boolean, eller en funktion som bara anropas när den behövs.
 */
export function remoteWins(local, remote, { pending = false, now = serverNow() } = {}) {
  if (!local) return true;
  const lt = local.updatedAt ?? 0;
  const rt = remote.updatedAt ?? 0;
  const lf = isFutureStamp(lt, now);
  const rf = isFutureStamp(rt, now);
  if (lf !== rf) return !(typeof pending === "function" ? pending() : pending);
  return rt >= lt;
}

/**
 * Ska en kölagd op (tidsstämpel opTime) skrivas över serverns version
 * (serverTime)? En framtida servertid kan aldrig blockera; opTime är redan
 * klämd av anroparen.
 */
export function opBeatsServer(opTime, serverTime, now = serverNow()) {
  if (opTime == null) return true;
  if (isFutureStamp(serverTime, now)) return true;
  return !(serverTime > opTime);
}

// ---- Uppstart: ta över en färsk mätning från ett annat fönster ----

try {
  const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
  if (raw) adoptStored(raw);
} catch { /* ingen lagring */ }

try {
  globalThis.window?.addEventListener?.("storage", (e) => {
    if (e.key === STORAGE_KEY && e.newValue) adoptStored(e.newValue);
  });
} catch { /* ingen window (Node) */ }
