/**
 * TIMER — bakgrundssäker tidshantering på TIDSSTÄMPLAR.
 *
 * Webbläsare stryper setInterval/setTimeout i bakgrundsflikar (ned
 * till 1 tick/minut), så en timer som RÄKNAR tickar driftar. Här är
 * tickandet bara en RITSIGNAL — återstående tid beräknas alltid från
 * epoch-tidsstämplar och blir därför rätt oavsett hur länge fönstret
 * legat i bakgrunden. (Trafikljusuret bygger på detta; Läge 4.)
 *
 * Timertillståndet är ett rent JSON-objekt:
 *   { durationMs, startedAt, pausedAt }   (pausedAt = null när den går)
 * → kan skickas över sync-kanalen (docs/SYNC.md) och sparas i
 * datalagret utan omvandling. Alla funktioner är rena; `now` kan
 * skickas in i test.
 *
 * Typiskt bruk:
 *   let t = createTimerState(5 * 60_000);
 *   const stopTick = createTicker(() => render(remainingMs(t)));
 */

/** Starta en ny timer på durationMs. */
export function createTimerState(durationMs, now = Date.now()) {
  return { durationMs, startedAt: now, pausedAt: null };
}

/** Pausa (no-op om redan pausad). */
export function pauseTimer(state, now = Date.now()) {
  if (!state || state.pausedAt != null) return state;
  return { ...state, pausedAt: now };
}

/** Återuppta (no-op om ej pausad). Paustiden räknas inte som förfluten. */
export function resumeTimer(state, now = Date.now()) {
  if (!state || state.pausedAt == null) return state;
  return { ...state, startedAt: state.startedAt + (now - state.pausedAt), pausedAt: null };
}

/** Lägg till/dra ifrån tid (t.ex. +1 min-knapp). Kan inte gå under 0 kvar. */
export function adjustTimer(state, deltaMs, now = Date.now()) {
  if (!state) return state;
  const next = { ...state, durationMs: Math.max(0, state.durationMs + deltaMs) };
  return remainingMs(next, now) < 0 ? { ...next, startedAt: now } : next;
}

/** Millisekunder kvar (aldrig negativt). 0 för null-tillstånd. */
export function remainingMs(state, now = Date.now()) {
  if (!state) return 0;
  const elapsed = (state.pausedAt ?? now) - state.startedAt;
  return Math.max(0, state.durationMs - elapsed);
}

/** Andel förfluten tid 0–1 (för visare/progressbågar). */
export function elapsedFraction(state, now = Date.now()) {
  if (!state || state.durationMs <= 0) return 1;
  return 1 - remainingMs(state, now) / state.durationMs;
}

export function isFinished(state, now = Date.now()) {
  return state != null && remainingMs(state, now) === 0;
}

/** "mm:ss" (eller "h:mm:ss" över en timme) — för stora nedräkningssiffror. */
export function formatMs(ms) {
  const total = Math.ceil(ms / 1000);
  const s = total % 60;
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);
  const pad = (n) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/**
 * Ritsignal: anropar onTick regelbundet medan fönstret är synligt och
 * OMEDELBART när fliken blir synlig igen (så vyn hoppar rätt direkt
 * efter en bakgrundsperiod — tiden själv har aldrig driftat).
 * Returnerar stop(). Anropa stop() i lägets unmount!
 */
export function createTicker(onTick, { intervalMs = 200 } = {}) {
  const tick = () => { try { onTick(); } catch (err) { console.warn("[timer] tick:", err); } };
  const interval = setInterval(tick, intervalMs);
  const onVisible = () => { if (!document.hidden) tick(); };
  document.addEventListener("visibilitychange", onVisible);
  tick();
  return () => {
    clearInterval(interval);
    document.removeEventListener("visibilitychange", onVisible);
  };
}
