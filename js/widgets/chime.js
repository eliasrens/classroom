/**
 * TIMRAR — tonen när tiden är ute (issue #117).
 *
 * En mjuk ton genererad med Web Audio (inga ljudfiler): tre dova
 * sinustoner (en stigande treklang) med långsam in- och uttoning.
 *
 * Tonen spelas i EXAKT ETT fönster — elevskärmen om den är öppen och får
 * spela ljud, annars lärarfönstret. Beslutet är rent och testat
 * (chimeRole/chimeStep/claimChime i timer-logic.js); här kopplas det till
 * fönstret: vilken vy det är, om elevskärmen är öppen (store.studentOpen,
 * presence-vakten i js/sync.js) och om webbläsaren tillåter ljud.
 *
 * Webbläsare låter ett fönster spela ljud först efter ett klick eller
 * en tangent i det. Därför "låses ljudet upp" vid första klicket (lärarens
 * Start-knapp räcker). En elevskärm som ingen klickat i lämnar tonen åt
 * lärarfönstret.
 *
 *   const chimer = createChimer({ view, classId, widgetId });
 *   chimer.check(view, sound, now);   // vid varje tick
 */

import { store } from "../store.js";
import { isPreviewWindow } from "../sync.js";
import { chimeRole, chimeStep, chimeKey, chimeClaimed, claimChime } from "./timer-logic.js";

let audio = null;

function context() {
  if (audio) return audio;
  const AC = globalThis.AudioContext ?? globalThis.webkitAudioContext;
  if (!AC) return null;
  try { audio = new AC(); } catch { audio = null; }
  return audio;
}

/** Får det här fönstret spela ljud just nu? */
export function audioReady() {
  const ctx = audio;
  if (ctx?.state === "running") return true;
  // Ett klick har skett men kontexten är inte skapad än → skapa nu.
  if (globalThis.navigator?.userActivation?.hasBeenActive) {
    const c = context();
    if (c && c.state !== "running") void c.resume?.().catch(() => {});
    return c?.state === "running";
  }
  return false;
}

/** Första klick/tangent i fönstret låser upp ljudet (webbläsarens krav). */
function unlock() {
  const c = context();
  if (c && c.state !== "running") void c.resume?.().catch(() => {});
}
if (typeof globalThis.addEventListener === "function" && typeof document !== "undefined") {
  const opts = { capture: true, passive: true };
  globalThis.addEventListener("pointerdown", unlock, opts);
  globalThis.addEventListener("keydown", unlock, opts);
}

/** Spela den mjuka tonen (≈ 2,5 s). */
export function playChime() {
  const c = context();
  if (!c) return false;
  if (c.state !== "running") void c.resume?.().catch(() => {});
  const t0 = c.currentTime + 0.05;
  const master = c.createGain();
  master.gain.value = 0.22;
  master.connect(c.destination);
  // C5 – E5 – G5, var och en med mjuk attack och lång avklingning.
  [523.25, 659.25, 783.99].forEach((freq, i) => {
    const start = t0 + i * 0.28;
    const osc = c.createOscillator();
    osc.type = "sine";
    osc.frequency.value = freq;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(0.9, start + 0.06);
    g.gain.exponentialRampToValueAtTime(0.0001, start + 1.9);
    osc.connect(g);
    g.connect(master);
    osc.start(start);
    osc.stop(start + 2);
  });
  return true;
}

function storage() {
  try { return globalThis.localStorage ?? null; } catch { return null; }
}

/**
 * En widget-instans tonvakt. `check(view, sound, now)` vid varje tick:
 * spelar tonen när `view.endMs` passerats — i rätt fönster, en gång.
 */
export function createChimer({ view, classId, widgetId }) {
  const key = chimeKey(classId, widgetId);
  const preview = isPreviewWindow();
  return {
    check(v, sound, now) {
      if (!sound || v?.endMs == null || now < v.endMs) return;
      const role = chimeRole({ view, preview, studentOpen: !!store.get().studentOpen });
      const step = chimeStep({
        sound, endMs: v.endMs, now, role,
        audioReady: role === "student" ? audioReady() : true,
        claimed: chimeClaimed(storage(), key, v.endMs),
      });
      if (step === "play" && claimChime(storage(), key, v.endMs)) playChime();
    },
  };
}
