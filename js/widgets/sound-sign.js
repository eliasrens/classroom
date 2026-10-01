/**
 * WIDGET — Ljudnivåskylt (issue #118).
 *
 * Visar vilken ljudnivå som gäller just nu: 0 Tyst, 1 Viska, 2 Prata lågt,
 * 3 Prata, 4 Redovisa — var och en med en färg (sound-level.js). Läraren
 * kan byta namn på nivåerna (inställning, cfg.names).
 *
 * Den valda nivån är KÖRTILLSTÅND ({ level }, js/widgets/runtime.js):
 * lokalt, synkat mellan lärarfönster och elevfönster, aldrig i molnet.
 * Läraren byter nivå med ett klick i inställningarna eller med de små
 * knapparna på skylten i lärarvyns förhandsvisning. Elevvyn har inga knappar
 * och skriver aldrig körtillståndet.
 *
 *  - Bricka:  "● 1 Viska" (färgprick, siffra, namn)
 *  - Stor:    rund färgad skylt med en enkel SVG-symbol per nivå + siffra och namn
 */

import { icon } from "../lib/icons.js";
import { readRuntime, writeRuntime, watchRuntime } from "./runtime.js";
import { LEVELS, DEFAULT_NAMES, MAX_NAME_LENGTH, normalizeNames, signLevelOf } from "./sound-level.js";

const esc = (s) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const cleanups = new WeakMap(); // el → cleanup()

const defaults = () => ({ names: [...DEFAULT_NAMES] });
const normalize = (cfg) => ({ ...cfg, names: normalizeNames(cfg?.names) });

// ---------------------------------------------------------------------------
// Symbolerna — egna enkla former (viewBox 0 0 100 100, currentColor):
// ett huvud med munnen och ljudvågor åt höger. Tyst = stängd mun och ett
// "sch"-finger, Viska = en prickad våg, sedan en, två och tre vågor.
// ---------------------------------------------------------------------------

function arc(r, deg = 36, cx = 38, cy = 50) {
  const a = (deg * Math.PI) / 180;
  const x = (cx + r * Math.cos(a)).toFixed(1);
  const y1 = (cy - r * Math.sin(a)).toFixed(1);
  const y2 = (cy + r * Math.sin(a)).toFixed(1);
  return `M${x} ${y1}A${r} ${r} 0 0 1 ${x} ${y2}`;
}

const MOUTHS = [
  `<path d="M30 60h16"/><path d="M38 46v26" stroke-width="7"/>`, // stängd mun + finger
  `<circle cx="38" cy="60" r="2.6" fill="currentColor" stroke="none"/>`,
  `<ellipse cx="38" cy="60" rx="4" ry="3.4" fill="currentColor" stroke="none"/>`,
  `<ellipse cx="38" cy="60" rx="5.5" ry="5" fill="currentColor" stroke="none"/>`,
  `<ellipse cx="38" cy="61" rx="7" ry="6.5" fill="currentColor" stroke="none"/>`,
];
const WAVES = [
  "",
  `<path d="${arc(34, 28)}" stroke-dasharray="0.1 8"/>`,
  `<path d="${arc(34)}"/>`,
  `<path d="${arc(34)}"/><path d="${arc(46)}"/>`,
  `<path d="${arc(34)}"/><path d="${arc(46)}"/><path d="${arc(58, 32)}"/>`,
];

/** SVG-symbolen för en nivå (0–4). */
export function signSymbol(level) {
  const l = signLevelOf({ level });
  return `<svg class="wsign__svg" viewBox="0 0 100 100" aria-hidden="true" focusable="false"
    fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="38" cy="50" r="24"/>
    <circle cx="30" cy="45" r="2.8" fill="currentColor" stroke="none"/>
    <circle cx="46" cy="45" r="2.8" fill="currentColor" stroke="none"/>
    ${MOUTHS[l]}${WAVES[l]}
  </svg>`;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const levelVars = (l) => `--lvl-color:${LEVELS[l].color};--lvl-ink:${LEVELS[l].ink}`;

function mount(el, cfg, ctx, form) {
  destroy(el);
  const names = normalizeNames(cfg?.names);
  const teacher = ctx?.view === "teacher";
  const btns = teacher
    ? (form === "chip"
      ? `<span class="wsign__steps">
          <button type="button" class="wsign__btn" data-sign-step="-1" title="Lägre ljudnivå" aria-label="Lägre ljudnivå">${icon("chevron-left")}</button>
          <button type="button" class="wsign__btn" data-sign-step="1" title="Högre ljudnivå" aria-label="Högre ljudnivå">${icon("chevron-right")}</button>
        </span>`
      : `<div class="wsign__pick" role="group" aria-label="Byt ljudnivå">${LEVELS.map((L) =>
          `<button type="button" class="wsign__btn" data-sign-set="${L.level}" style="${levelVars(L.level)}"
            title="${L.level} ${esc(names[L.level])}" aria-label="${L.level} ${esc(names[L.level])}">${L.level}</button>`).join("")}</div>`)
    : "";
  el.innerHTML = form === "chip"
    ? `<span class="wsign wsign--chip" role="status">
        <span class="wsign__dot" aria-hidden="true"></span><span class="wsign__num"></span><span class="wsign__name"></span>${btns}
      </span>`
    : `<div class="wsign wsign--large" role="status">
        <div class="wsign__main">
          <div class="wsign__badge"></div>
          <div class="wsign__text"><span class="wsign__num"></span><span class="wsign__name"></span></div>
        </div>${btns}
      </div>`;
  const root = el.firstElementChild;
  const num = root.querySelector(".wsign__num");
  const name = root.querySelector(".wsign__name");
  const badge = root.querySelector(".wsign__badge");
  let shown = null;

  const draw = (state) => {
    const l = signLevelOf(state);
    if (l === shown) return;
    shown = l;
    root.dataset.level = String(l);
    root.setAttribute("style", levelVars(l));
    num.textContent = String(l);
    name.textContent = names[l];
    root.setAttribute("aria-label", `Ljudnivå ${l}: ${names[l]}`);
    if (badge) badge.innerHTML = signSymbol(l);
    for (const b of root.querySelectorAll("[data-sign-set]")) b.setAttribute("aria-pressed", String(Number(b.dataset.signSet) === l));
    for (const b of root.querySelectorAll("[data-sign-step]")) {
      b.disabled = (b.dataset.signStep === "-1" && l === 0) || (b.dataset.signStep === "1" && l === LEVELS.length - 1);
    }
  };
  draw(ctx?.runtime?.read?.());
  const offWatch = ctx?.runtime?.watch?.((s) => draw(s)) ?? (() => {});

  // Bara lärarvyn har knappar — elevvyn skriver aldrig körtillståndet.
  const onClick = (e) => {
    if (!teacher) return;
    const set = e.target.closest?.("[data-sign-set]");
    const step = e.target.closest?.("[data-sign-step]");
    if (!set && !step) return;
    e.preventDefault();
    e.stopPropagation();
    const cur = signLevelOf(ctx.runtime.read());
    const next = set ? Number(set.dataset.signSet) : cur + Number(step.dataset.signStep);
    if (next < 0 || next >= LEVELS.length || next === cur) return;
    ctx.runtime.write({ level: next });
  };
  if (teacher) el.addEventListener("click", onClick);
  cleanups.set(el, () => {
    offWatch();
    el.removeEventListener("click", onClick);
  });
}

function destroy(el) {
  cleanups.get(el)?.();
  cleanups.delete(el);
}

// ---------------------------------------------------------------------------
// Inställningar: nivån just nu (ett klick) + namnen
// ---------------------------------------------------------------------------

function settingsHTML(cfg, ctx) {
  const names = normalizeNames(cfg?.names);
  const cur = signLevelOf(readRuntime(ctx?.classId ?? null, ctx?.widgetId));
  return `<div class="wsnd-set">
    <div class="wsnd-set__label">Ljudnivå just nu</div>
    <div class="wsign-set__levels" role="group" aria-label="Ljudnivå just nu">${LEVELS.map((L) =>
      `<button type="button" class="wsign-set__level" data-wsign-level="${L.level}" style="${levelVars(L.level)}"
        aria-pressed="${L.level === cur}"><span class="wsign__dot" aria-hidden="true"></span>
        <span class="wsign-set__n">${L.level}</span> <span data-wsign-label="${L.level}">${esc(names[L.level])}</span></button>`).join("")}
    </div>
    <details class="wsign-set__names">
      <summary>Byt namn på nivåerna</summary>
      <div class="wsign-set__grid">${LEVELS.map((L) =>
        `<label class="wsign-set__name" style="${levelVars(L.level)}"><span class="wsign__dot" aria-hidden="true"></span><span>${L.level}</span>
          <input type="text" data-wsign-name="${L.level}" value="${esc(names[L.level])}" placeholder="${esc(DEFAULT_NAMES[L.level])}"
            maxlength="${MAX_NAME_LENGTH}" autocomplete="off" aria-label="Namn på nivå ${L.level}"></label>`).join("")}
      </div>
    </details>
  </div>`;
}

function bindSettings(root, cfg, onChange, ctx) {
  const classId = ctx?.classId ?? null;
  const widgetId = ctx?.widgetId;
  let cur = normalize(cfg ?? {});

  const mark = (state) => {
    const l = signLevelOf(state);
    for (const b of root.querySelectorAll("[data-wsign-level]")) b.setAttribute("aria-pressed", String(Number(b.dataset.wsignLevel) === l));
  };
  const off = widgetId ? watchRuntime(classId, widgetId, mark) : () => {};

  const onClick = (e) => {
    const b = e.target.closest?.("[data-wsign-level]");
    if (!b || !widgetId) return;
    writeRuntime(classId, widgetId, { level: Number(b.dataset.wsignLevel) });
  };
  const onInput = (e) => {
    const i = e.target?.dataset?.wsignName;
    if (i == null) return;
    const names = [...cur.names];
    names[Number(i)] = e.target.value;
    cur = { ...cur, names: normalizeNames(names) };
    const label = root.querySelector(`[data-wsign-label="${i}"]`);
    if (label) label.textContent = cur.names[Number(i)];
    onChange(cur);
  };
  root.addEventListener("click", onClick);
  root.addEventListener("input", onInput);
  return () => {
    off();
    root.removeEventListener("click", onClick);
    root.removeEventListener("input", onInput);
  };
}

export default {
  id: "sound-sign",
  name: "Ljudnivåskylt",
  icon: "sound-sign",
  multiple: false,
  defaults,
  normalize: (cfg) => normalize({ ...defaults(), ...cfg }),
  renderChip: (el, cfg, ctx) => mount(el, cfg, ctx, "chip"),
  renderLarge: (el, cfg, ctx) => mount(el, cfg, ctx, "large"),
  destroy,
  settingsHTML,
  bindSettings,
};
