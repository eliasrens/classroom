/**
 * WIDGET — Klocka (analog), issue #116.
 *
 * En tydlig skolklocka i SVG: siffrorna 1–12, minutstreck, tim- och
 * minutvisare och en valfri sekundvisare (standard av). Tiden kommer från
 * serverNow() (js/lib/clock.js).
 *
 *  - Stor på Morgonskärmen: glaset (.mw) blir självt en rund urtavla med
 *    vita siffror och visare, som den digitala klockan i glaset.
 *  - Bricka i lektionens rubrikrad: en liten urtavla, ungefär radens höjd,
 *    i ämnesfärgen (--subj-ink). På en liten tavla visas bara 12, 3, 6 och
 *    9 (större), på en mycket liten bara timstrecken — så att det som syns
 *    går att läsa (container-frågor i css/ui/widgets.css).
 *
 * Ritas om vid varje sekundskifte med sekundvisare, annars vid varje
 * minutskifte (createClockTicker). Visarna "tickar" med en kort övergång —
 * ingen övergång alls med prefers-reduced-motion (CSS). Vinklarna räknas
 * i rena funktioner (handAngles, unwrapAngle) som testas i
 * docs/test-clock-widgets.mjs.
 */

import { serverNow } from "../lib/clock.js";
import { createClockTicker, togglesHTML, bindToggles } from "./clock-shared.js";
import { formatClock } from "./clock-digital.js";

const stops = new WeakMap(); // el → stop()

/**
 * Visarnas vinklar i grader medurs från klockan 12, för tidpunkten `now`
 * (lokal tid). Utan `seconds` står minutvisaren på hel minut (som en
 * skolklocka som hoppar varje minut) och timvisaren följer den.
 *   → { hour: 0–<360, minute: 0–<360, second: 0–354 }
 */
export function handAngles(now = serverNow(), { seconds = false } = {}) {
  const d = new Date(now);
  const s = d.getSeconds();
  const m = d.getMinutes() + (seconds ? s / 60 : 0);
  const h = (d.getHours() % 12) + m / 60;
  return { hour: h * 30, minute: m * 6, second: s * 6 };
}

/**
 * Samma vinkel som `next` (mod 360) men så nära `prev` som möjligt — så att
 * en visare som går från 354° till 0° tickar framåt (till 360°) i stället
 * för att snurra ett varv baklänges i övergången.
 */
export function unwrapAngle(prev, next) {
  if (prev == null || !Number.isFinite(prev)) return next;
  const base = prev - (((prev % 360) + 360) % 360);
  let a = base + next;
  if (a < prev - 180) a += 360;
  else if (a > prev + 180) a -= 360;
  return a;
}

// ---------------------------------------------------------------------------
// Urtavlan (viewBox −100…100, 12 rakt upp; visarna ritas pekande uppåt och
// vrids runt mitten)
// ---------------------------------------------------------------------------

const round = (n) => Math.round(n * 100) / 100;

function dialSVG({ seconds }) {
  const ticks = Array.from({ length: 60 }, (_, i) => {
    const hour = i % 5 === 0;
    return `<line class="wanalog__tick${hour ? " wanalog__tick--hour" : ""}${i % 15 ? "" : " wanalog__tick--q"}" x1="0" y1="${hour ? -80 : -85}" x2="0" y2="-90" transform="rotate(${i * 6})"/>`;
  }).join("");
  const nums = Array.from({ length: 12 }, (_, i) => {
    const n = i + 1;
    const a = (n * 30 * Math.PI) / 180;
    return `<text${n % 3 ? "" : ' class="wanalog__num--q"'} x="${round(Math.sin(a) * 66)}" y="${round(-Math.cos(a) * 66)}">${n}</text>`;
  }).join("");
  const sec = seconds
    ? `<g class="wanalog__hand wanalog__hand--second">
        <line x1="0" y1="22" x2="0" y2="-80"/><circle r="4.2"/>
      </g>`
    : "";
  return `<svg class="wanalog__svg" viewBox="-100 -100 200 200" aria-hidden="true" focusable="false">
    <circle class="wanalog__face" r="96"/>
    <g class="wanalog__ticks">${ticks}</g>
    <g class="wanalog__nums">${nums}</g>
    <g class="wanalog__hand wanalog__hand--hour"><line x1="0" y1="12" x2="0" y2="-47"/></g>
    <g class="wanalog__hand wanalog__hand--minute"><line x1="0" y1="14" x2="0" y2="-74"/></g>
    <circle class="wanalog__cap" r="6.5"/>
    ${sec}
  </svg>`;
}

const defaults = () => ({ seconds: false });

function normalize(cfg) {
  return { ...cfg, seconds: cfg.seconds === true };
}

function mount(el, cfg, form) {
  destroy(el);
  const c = normalize(cfg ?? {});
  el.innerHTML = `<div class="wanalog wanalog--${form}" role="img">${dialSVG(c)}</div>`;
  const root = el.firstElementChild;
  const hands = {
    hour: root.querySelector(".wanalog__hand--hour"),
    minute: root.querySelector(".wanalog__hand--minute"),
    second: root.querySelector(".wanalog__hand--second"),
  };
  const prev = {};
  let label = "";
  const stop = createClockTicker((now) => {
    const a = handAngles(now, c);
    for (const k of Object.keys(hands)) {
      const g = hands[k];
      if (!g) continue;
      const v = round(unwrapAngle(prev[k], a[k]));
      if (v === prev[k]) continue;
      prev[k] = v;
      g.style.transform = `rotate(${v}deg)`;
    }
    const text = `Klockan är ${formatClock(now, c)}`;
    if (text !== label) { label = text; root.setAttribute("aria-label", text); }
  }, { periodMs: c.seconds ? 1000 : 60_000, el });
  // Visarna står på rätt plats från första bilden — övergången (tickandet)
  // slås på först efter den, annars snurrar de in vid varje omritning.
  let raf = requestAnimationFrame(() => {
    raf = requestAnimationFrame(() => { raf = 0; root.classList.add("wanalog--live"); });
  });
  stops.set(el, () => { stop(); if (raf) cancelAnimationFrame(raf); });
}

function destroy(el) {
  stops.get(el)?.();
  stops.delete(el);
}

const OPTIONS = [{ key: "seconds", label: "Visa sekundvisare" }];

export default {
  id: "clock-analog",
  name: "Klocka (analog)",
  icon: "clock",
  multiple: false,
  shape: "round", // stor på Morgonskärmen: rund urtavla — krockar räknas mot cirkeln (#119)
  defaults,
  normalize: (cfg) => normalize({ ...defaults(), ...cfg }),
  renderChip: (el, cfg) => mount(el, cfg, "chip"),
  renderLarge: (el, cfg) => mount(el, cfg, "large"),
  destroy,
  settingsHTML: (cfg) => togglesHTML(OPTIONS, normalize(cfg ?? {})),
  bindSettings: (root, cfg, onChange) => bindToggles(root, normalize(cfg ?? {}), onChange),
};
