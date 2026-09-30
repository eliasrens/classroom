/**
 * WIDGET — Klocka (digital), issue #115 + #116.
 *
 * HH:MM (alltid 24-timmars) enligt appens synkade klocka (serverNow,
 * js/lib/clock.js). Kompakt bricka i lektionens rubrikrad, stor siffra i
 * ett hörn på Morgonskärmen.
 *
 * Inställningar (#116):
 *   seconds — visa sekunder (HH:MM:SS), standard av
 *   date    — visa datum under tiden ("tisdag 29 september"), standard av
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
  el.innerHTML = `<span class="wclock wclock--${form}">
    <time class="wclock__time"></time>${c.date ? `<time class="wclock__date"></time>` : ""}
  </span>`;
  const wrap = el.firstElementChild;
  const timeEl = el.querySelector(".wclock__time");
  const dateEl = el.querySelector(".wclock__date");
  // Brickan: får datumet inte plats bredvid tiden bryts det till en rad som
  // klipps (CSS) — då döljs det helt så att brickan krymper till bara tiden.
  // Mäts om när rubrikradens yta ändrar storlek (den har contain: size, så
  // brickan själv kan inte ändra ytans storlek — ingen återkoppling).
  let fit = () => {};
  let ro = null;
  if (form === "chip" && dateEl && typeof ResizeObserver === "function") {
    fit = () => {
      wrap.classList.remove("wclock--no-date");
      if (dateEl.offsetTop > timeEl.offsetTop + 1) wrap.classList.add("wclock--no-date");
    };
    ro = new ResizeObserver(() => fit());
    ro.observe(el.parentElement ?? el);
  }
  const put = (out, text, attr) => {
    if (out.textContent === text) return false;
    out.textContent = text;
    out.dateTime = attr;
    return true;
  };
  const stop = createClockTicker((now) => {
    const time = formatClock(now, c);
    put(timeEl, time, time);
    if (dateEl && put(dateEl, formatDate(now), isoDate(now))) fit();
  }, { periodMs: c.seconds ? 1000 : 60_000, el });
  stops.set(el, () => { stop(); ro?.disconnect(); });
}

function destroy(el) {
  stops.get(el)?.();
  stops.delete(el);
}

const OPTIONS = [
  { key: "seconds", label: "Visa sekunder" },
  { key: "date", label: "Visa datum" },
];

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
  settingsHTML: (cfg) => togglesHTML(OPTIONS, normalize(cfg ?? {})),
  bindSettings: (root, cfg, onChange) => bindToggles(root, normalize(cfg ?? {}), onChange),
};
