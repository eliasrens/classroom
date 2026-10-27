/**
 * Skallogiken för lektionstavlan (js/modes/lektion.js, fitBoard) som rena
 * funktioner — mätningen och CSS-variablerna kommer in som callbacks, så
 * att logiken går att testa utan webbläsare (docs/test-board-fit.mjs).
 *
 * - searchScale: största skala i [min, hi] där `fits()` håller (binärsökning).
 * - fitMidColumn (issue #134): "Efter rasten"-rutan påverkar bara mitten-
 *   kolumnen. Tavlans --lb-scale räknas UTAN rutan; ryms sedan inte rutan +
 *   Lektionsordning krymps först bara Lektionsordnings text, och bara så
 *   mycket som behövs.
 * - fitBreakColumn (issue #136): rutan utan Lektionsordning, i en egen smal
 *   kolumn — kolumnen ger upp bredd, sedan krymps bara rutans text.
 */

export const FIT_MIN = 0.45;
export const FIT_PRECISION = 0.01;

/**
 * Största skala i [min, hi] där `fits()` håller, ~6 mätningar. `set(s)` sätter
 * skalan innan varje mätning; den returnerade skalan är satt när funktionen
 * är klar. Ryms inget ens vid `min` blir det `min` (texten klipps hellre än
 * att bli oläsligt liten).
 */
export function searchScale(hi, fits, set, { min = FIT_MIN, precision = FIT_PRECISION } = {}) {
  set(hi);
  if (fits()) return hi;
  let lo = min;
  while (hi - lo > precision) {
    const mid = (lo + hi) / 2;
    set(mid);
    if (fits()) lo = mid; else hi = mid;
  }
  set(lo);
  return lo;
}

/**
 * Mittenkolumnen med "Efter rasten"-rutan, efter att tavlans skala redan är
 * satt (räknad utan rutan). `fits()` = ryms kolumnen (ruta + Lektionsordning);
 * `setSteps`/`setBreak` sätter Lektionsordnings resp. rutans egen skala.
 *
 * 1. Ryms allt redan: båda står på 1 — inget krymps i onödan.
 * 2. Annars krymps bara Lektionsordning (binärsökning i [min, 1]).
 * 3. Reserv: ryms kolumnen inte ens med Lektionsordning på `min` krymps
 *    rutans text också — men fortfarande bara i mittenkolumnen, aldrig
 *    resten av tavlan.
 *
 * → { steps, brk } — skalorna som sattes.
 */
export function fitMidColumn({ fits, setSteps, setBreak, min = FIT_MIN, precision = FIT_PRECISION }) {
  setBreak(1);
  const steps = searchScale(1, fits, setSteps, { min, precision });
  if (steps > min || fits()) return { steps, brk: 1 };
  const brk = searchScale(1, fits, setBreak, { min, precision });
  return { steps, brk };
}

/**
 * "Efter rasten" utan Lektionsordning (issue #136): rutan har en egen smal
 * mittenkolumn. Tavlans --lb-scale är redan satt (räknad utan kolumnen).
 * `want` = kolumnens önskade bredd, `floor` = dess golv (px).
 *
 * 1. Kolumnen ger upp bredd (ner till `floor`) tills sidokolumnerna ryms
 *    (`sidesFit`) — tavlans text krymps aldrig för rutans skull.
 * 2. Ryms rutan sedan inte i kolumnen (`fits`) krymps bara rutans text
 *    (`setBreak`), i [min, 1]. Klipps först om inte ens det räcker.
 *
 * → { width, brk } — bredden och rutans skala som sattes.
 */
export function fitBreakColumn({ want, floor, sidesFit, setWidth, fits, setBreak, min = FIT_MIN, precision = FIT_PRECISION }) {
  setBreak(1);
  const lo = want > 0 ? Math.min(1, floor / want) : 1;
  const f = searchScale(1, sidesFit, (t) => setWidth(want * t), { min: lo, precision });
  const brk = searchScale(1, fits, setBreak, { min, precision });
  return { width: want * f, brk };
}
