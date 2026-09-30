/**
 * WIDGET — Klocka (digital), issue #115.
 *
 * Första widgeten: HH:MM enligt appens synkade klocka (serverNow,
 * js/lib/clock.js). Kompakt bricka i lektionens rubrikrad, stor siffra i
 * ett hörn på Morgonskärmen. Inga egna inställningar ännu — del 2
 * (klockorna) bygger ut den.
 */

import { serverNow } from "../lib/clock.js";
import { createTicker } from "../lib/timer.js";

const stops = new WeakMap(); // el → stop()

const pad2 = (n) => String(n).padStart(2, "0");

/** "HH:MM" i lokal tid för tidpunkten `now`. */
export function formatClock(now = serverNow()) {
  const d = new Date(now);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function mount(el, className) {
  destroy(el);
  el.innerHTML = `<time class="${className}"></time>`;
  const out = el.firstElementChild;
  // Ritsignal varje sekund — texten skrivs bara när minuten bytts.
  stops.set(el, createTicker(() => {
    const text = formatClock();
    if (out.textContent !== text) {
      out.textContent = text;
      out.dateTime = text;
    }
  }, { intervalMs: 1000 }));
}

function destroy(el) {
  stops.get(el)?.();
  stops.delete(el);
}

export default {
  id: "clock-digital",
  name: "Klocka (digital)",
  icon: "clock",
  multiple: false,
  defaults: () => ({}),
  renderChip: (el) => mount(el, "wclock wclock--chip"),
  renderLarge: (el) => mount(el, "wclock wclock--large"),
  destroy,
};
