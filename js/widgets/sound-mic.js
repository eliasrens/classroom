/**
 * WIDGETS — mikrofonen för Ljudmätaren (issue #118).
 *
 * DATASKYDD: ljudet analyseras lokalt, i det här fönstret. Inget spelas
 * in, lagras eller skickas — bara ett tal (den jämnade nivån 0–1) lämnar
 * tjänsten, och Ljudmätaren skickar det talet till elevskärmen via
 * sync-bussen (samma dator).
 *
 * EN mikrofon per fönster: tjänsten är en enda instans (`mic`), och den
 * öppnas bara i lärarvyn när läraren trycker Starta. Den öppnas aldrig
 * två gånger — startar en annan mätare tar den över samma ström.
 *
 * Den stängs helt (alla tracks stoppas, ljudkontexten stängs):
 *   - när läraren trycker Stoppa (stop()),
 *   - när ingen vy av mätaren finns kvar — widgeten kryssades ur eller
 *     läget byttes (attach/detach nedan),
 *   - när fönstret stängs (pagehide).
 *
 *   const detach = mic.attach(widgetId);   // varje vy av mätaren (bricka, stor, inställningar)
 *   await mic.start(widgetId);             // lärarens Starta
 *   const off = mic.subscribe(({ status, owner, level }) => …);
 *   mic.stop();
 *   detach();                              // sista vyn borta → mikrofonen stängs
 *
 * Status: "off" | "starting" | "on" | "denied" (nekad) | "unavailable"
 * (ingen mikrofon) | "error".
 *
 * Vyerna monteras om ofta (lektionens brickor vid varje tangenttryck), så
 * "ingen vy kvar" avgörs FÖRDRÖJT: en vy som tas bort och direkt monteras
 * igen i samma omritning håller mikrofonen igång.
 */

import { meanSquare, levelFromRms, createRmsSmoother } from "./sound-level.js";

const AUDIO = { echoCancellation: false, noiseSuppression: false, autoGainControl: false };

function defaultGetUserMedia(constraints) {
  const md = globalThis.navigator?.mediaDevices;
  if (!md?.getUserMedia) {
    const err = new Error("Ingen mikrofon i den här webbläsaren");
    err.name = "NotFoundError";
    return Promise.reject(err);
  }
  return md.getUserMedia(constraints);
}

function defaultAudioContext() {
  const AC = globalThis.AudioContext ?? globalThis.webkitAudioContext;
  if (!AC) throw Object.assign(new Error("Web Audio saknas"), { name: "NotSupportedError" });
  return new AC();
}

/** Felet från getUserMedia → status. */
export function statusForError(err) {
  const name = err?.name ?? "";
  if (name === "NotAllowedError" || name === "SecurityError" || name === "PermissionDeniedError") return "denied";
  if (name === "NotFoundError" || name === "DevicesNotFoundError" || name === "OverconstrainedError"
    || name === "NotReadableError" || name === "NotSupportedError") return "unavailable";
  return "error";
}

export function createMicService({
  getUserMedia = defaultGetUserMedia,
  createAudioContext = defaultAudioContext,
  now = () => Date.now(),
  sampleMs = 100,
  windowMs = 500,
  setTimer = (fn, ms) => setInterval(fn, ms),
  clearTimer = (id) => clearInterval(id),
  defer = (fn) => setTimeout(fn, 0),
} = {}) {
  let status = "off";
  let owner = null;
  let level = 0;
  let gen = 0; // ogiltigförklarar en start som fortfarande väntar på behörighet
  let stream = null;
  let ctx = null;
  let source = null;
  let analyser = null;
  let timer = null;
  let buf = null;
  const smoother = createRmsSmoother({ windowMs });
  const subs = new Set();
  const views = new Map(); // owner → antal monterade vyer

  const snapshot = () => ({ status, owner, level });

  function emit() {
    const s = snapshot();
    for (const cb of subs) {
      try { cb(s); } catch (err) { console.warn("[ljudmätare] lyssnare:", err); }
    }
  }

  /** Stäng allt som hör till ljudet — tracks, källa, kontext, samplingen. */
  function release() {
    if (timer != null) clearTimer(timer);
    timer = null;
    try { source?.disconnect(); } catch { /* ok */ }
    for (const t of stream?.getTracks?.() ?? []) {
      try { t.onended = null; t.stop(); } catch { /* ok */ }
    }
    try { ctx?.close?.(); } catch { /* ok */ }
    stream = ctx = source = analyser = buf = null;
    smoother.reset();
    level = 0;
  }

  function sample() {
    if (!analyser) return;
    if (analyser.getFloatTimeDomainData) analyser.getFloatTimeDomainData(buf);
    level = levelFromRms(smoother.push(meanSquare(buf), now()));
    emit();
  }

  async function start(who) {
    if (who == null) return status;
    if (status === "on" || status === "starting") {
      // Samma ström — öppnas aldrig två gånger. En annan mätare tar över den.
      if (owner !== who) { owner = who; emit(); }
      return status;
    }
    const my = ++gen;
    owner = who;
    status = "starting";
    emit();
    let s;
    try {
      s = await getUserMedia({ audio: AUDIO, video: false });
    } catch (err) {
      if (my !== gen) return status;
      status = statusForError(err);
      emit();
      return status;
    }
    if (my !== gen) {
      // Stoppad (eller vyn stängd) medan läraren svarade på frågan: släpp direkt.
      for (const t of s?.getTracks?.() ?? []) { try { t.stop(); } catch { /* ok */ } }
      return status;
    }
    try {
      stream = s;
      ctx = createAudioContext();
      source = ctx.createMediaStreamSource(stream);
      analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser); // aldrig vidare till högtalarna
      buf = new Float32Array(analyser.fftSize);
      void ctx.resume?.();
      for (const t of stream.getTracks?.() ?? []) {
        // Mikrofonen drogs ur / stängdes av systemet.
        t.onended = () => { if (my === gen) { release(); status = "unavailable"; emit(); } };
      }
      timer = setTimer(sample, sampleMs);
      status = "on";
    } catch (err) {
      release();
      status = statusForError(err);
    }
    emit();
    return status;
  }

  /** Stäng mikrofonen helt. */
  function stop() {
    gen++;
    const was = status;
    release();
    status = "off";
    if (was !== "off") emit();
  }

  /** Stäng om ägaren inte har någon vy kvar (fördröjt, se ovan). */
  function checkOwner() {
    if (owner == null || (views.get(owner) ?? 0) > 0) return;
    const was = status;
    gen++;
    release();
    status = "off";
    owner = null;
    if (was !== "off") emit();
  }

  /** En vy av mätaren `who` är monterad. → detach(). */
  function attach(who) {
    views.set(who, (views.get(who) ?? 0) + 1);
    let done = false;
    return () => {
      if (done) return;
      done = true;
      const n = (views.get(who) ?? 1) - 1;
      if (n > 0) views.set(who, n);
      else views.delete(who);
      if (n <= 0 && who === owner) defer(checkOwner);
    };
  }

  return {
    start,
    stop,
    attach,
    subscribe(cb) { subs.add(cb); return () => subs.delete(cb); },
    get status() { return status; },
    get owner() { return owner; },
    get level() { return level; },
    /** true medan mikrofonen är öppen (eller håller på att öppnas). */
    get open() { return stream != null || status === "starting"; },
  };
}

/** Fönstrets enda mikrofontjänst. */
export const mic = createMicService();

// Fönstret stängs / laddas om → stäng mikrofonen.
globalThis.addEventListener?.("pagehide", () => mic.stop());
