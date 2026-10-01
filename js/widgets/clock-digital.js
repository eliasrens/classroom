/**
 * WIDGET — Klocka (digital), issue #115 + #116.
 *
 * HH:MM (alltid 24-timmars) enligt appens synkade klocka (serverNow,
 * js/lib/clock.js). Kompakt bricka i lektionens rubrikrad, stor siffra i
 * ett hörn på Morgonskärmen.
 *
 * Inställningar (#116):
 *   seconds — visa sekunder (HH:MM:SS), standard av
 *   date    — visa datum under tiden ("tisdag 29 september"), standard av.
 *             Bara på Morgonskärmen (#119): lektionens formulär visar inte
 *             valet, och brickan visar aldrig datum även om cfg har det.
 *
 * Utan sekunder ritas klockan om vid varje minutskifte, med sekunder vid
 * varje sekundskifte (createClockTicker, js/widgets/clock-shared.js).
 */

import { serverNow } from "../lib/clock.js";
import { createClockTicker, formatDate, isoDate, pad2, togglesHTML, bindToggles } from "./clock-shared.js";

const stops = new WeakMap(); // el → stop()

/** "HH:MM" (eller "HH:MM:SS" med `seconds`) i lokal tid för tidpunkten `now`. */
export function formatClock(now = serverNow(), { seconds = false } = {}) {
  const d = new Date(now);
  const hm = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  return seconds ? `${hm}:${pad2(d.getSeconds())}` : hm;
}

export { formatDate };

const defaults = () => ({ seconds: false, date: false });

function normalize(cfg) {
  return { ...cfg, seconds: cfg.seconds === true, date: cfg.date === true };
}

function mount(el, cfg, form) {
  destroy(el);
  const c = normalize(cfg ?? {});
  // Datum hör till Morgonskärmen — aldrig i lektionens rubrikbricka (#119).
  const showDate = form === "large" && c.date;
  el.innerHTML = `<span class="wclock wclock--${form}">
    <time class="wclock__time"></time>${showDate ? `<time class="wclock__date"></time>` : ""}
  </span>`;
  const timeEl = el.querySelector(".wclock__time");
  const dateEl = el.querySelector(".wclock__date");
  const put = (out, text, attr) => {
    if (out.textContent === text) return;
    out.textContent = text;
    out.dateTime = attr;
  };
  const stop = createClockTicker((now) => {
    const time = formatClock(now, c);
    put(timeEl, time, time);
    if (dateEl) put(dateEl, formatDate(now), isoDate(now));
  }, { periodMs: c.seconds ? 1000 : 60_000, el });
  stops.set(el, stop);
}

function destroy(el) {
  stops.get(el)?.();
  stops.delete(el);
}

const OPTIONS = [
  { key: "seconds", label: "Visa sekunder" },
  { key: "date", label: "Visa datum", only: "morning" },
];
/** Valen som hör till formuläret (ctx.form): "Visa datum" bara på Morgonskärmen. */
const optionsFor = (ctx) => OPTIONS.filter((o) => !o.only || o.only === ctx?.form);

export default {
  id: "clock-digital",
  name: "Klocka (digital)",
  icon: "clock-digital",
  multiple: false,
  defaults,
  normalize: (cfg) => normalize({ ...defaults(), ...cfg }),
  renderChip: (el, cfg) => mount(el, cfg, "chip"),
  renderLarge: (el, cfg) => mount(el, cfg, "large"),
  destroy,
  settingsHTML: (cfg, ctx) => togglesHTML(optionsFor(ctx), normalize(cfg ?? {})),
  bindSettings: (root, cfg, onChange) => bindToggles(root, normalize(cfg ?? {}), onChange),
};
