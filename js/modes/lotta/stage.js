/**
 * LOTTNINGENS SCEN (issue #47) — hjulet, namnrullen, lapparna och
 * resultatet. Samma kod ritar lärarens förhandsvisning och elevskärmen,
 * så en dragning ser likadan ut i båda fönstren: allt som rör sig räknas
 * ur dragningens data (vinklar, rader, frö) och tiden sedan starten.
 *
 * Scenen har inga kontroller — lärarvyn lägger sina knappar utanför.
 * Tillståndet står som data-attribut på roten (bra för test och CSS):
 *   data-method  hjul | rulle | lapp | direkt
 *   data-phase   idle | drawing | result
 *   data-result  resultatets text (tom tills dragningen landat)
 *
 * Animationen drivs av requestAnimationFrame mot en tidsstämpel, med en
 * setTimeout som ser till att resultatet visas i tid även när fönstret
 * ligger i bakgrunden (där webbläsaren pausar rAF).
 *
 * Scenens data ("stage", se DATAMODELL.md → lotta/stage):
 *   { rev, seq, method, listKey, kind: "names"|"colors"|"text",
 *     items: [{ label, color? }], result: index|null, angle, reelIndex }
 * Dragningen (`lotta:draw` → draw):
 *   { seq, method, list, resultIndex, seed, from, to, start, land, startedAt }
 */

import { icon } from "../../lib/icons.js";
import { readableTextColor } from "../../lib/color.js";
import {
  METHOD_IDS, DEFAULT_METHOD, DURATION_MS, RESULT_IN_MS,
  seededRandom, easeOutQuart, easeOutCubic, reelItemAt,
} from "../../lib/lotta.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const PILE_MAX = 12;
const PILE_SEED = 4711; // lapparnas viloläge — samma i alla fönster
const BIG_NOTE = 2.7;   // den dragna lappens förstoring

/** Dämpade tårtbitsfärger (ur ämnespaletten) för listor utan egna färger. */
const PALETTE = ["#5577b5", "#b05f7d", "#4e8f72", "#b88540", "#7a63a8", "#4f93a8", "#b3564e", "#85905f"];

const KINDS = new Set(["names", "colors", "text"]);
const HEX = /^#[0-9a-f]{6}$/i;

export const reducedMotion = () => {
  try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; }
};

const escapeHtml = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => (
  { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const lerp = (a, b, t) => a + (b - a) * t;
const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

// ---- Validering (elevskärmen litar aldrig blint på det som kommer in) ----

export function normalizeStage(raw) {
  if (!raw || typeof raw !== "object") return null;
  const items = Array.isArray(raw.items)
    ? raw.items.filter((it) => typeof it?.label === "string").slice(0, 500)
      .map((it) => (HEX.test(it.color ?? "") ? { label: it.label, color: it.color } : { label: it.label }))
    : [];
  const result = Number.isInteger(raw.result) && raw.result >= 0 && raw.result < items.length ? raw.result : null;
  return {
    rev: Number(raw.rev) || 0,
    seq: Number.isInteger(raw.seq) ? raw.seq : 0,
    method: METHOD_IDS.includes(raw.method) ? raw.method : DEFAULT_METHOD,
    listKey: typeof raw.listKey === "string" ? raw.listKey : "",
    kind: KINDS.has(raw.kind) ? raw.kind : "text",
    items,
    result,
    angle: Number.isFinite(raw.angle) ? raw.angle : 0,
    reelIndex: Number.isInteger(raw.reelIndex) && raw.reelIndex >= 0 && raw.reelIndex < items.length ? raw.reelIndex : 0,
  };
}

export function normalizeDraw(raw, stage) {
  if (!raw || !stage || stage.result == null) return null;
  const n = stage.items.length;
  const int = (v, d = 0) => (Number.isInteger(v) ? v : d);
  return {
    seq: int(raw.seq),
    method: stage.method,
    seed: Number.isInteger(raw.seed) ? raw.seed >>> 0 : 1,
    from: Number.isFinite(raw.from) ? raw.from : 0,
    to: Number.isFinite(raw.to) ? raw.to : stage.angle,
    start: clamp(int(raw.start), 0, Math.max(0, n - 1)),
    land: clamp(int(raw.land), 0, 5000),
    startedAt: Number(raw.startedAt) || Date.now(),
  };
}

// ---- Scenen -------------------------------------------------------------------

/**
 * createStage(root) → { render(stage, {message}), play(stage, draw, {offset, onDone}), destroy() }
 * root är en tom .lot-stage.
 */
export function createStage(root) {
  root.innerHTML = `
    <div class="lot-show"></div>
    <div class="lot-msg" hidden></div>
    <div class="lot-result" hidden aria-live="polite">
      <div class="lot-result__card"><span class="lot-result__text"></span></div>
    </div>`;
  const show = root.querySelector(".lot-show");
  const msg = root.querySelector(".lot-msg");
  const result = root.querySelector(".lot-result");
  const resultCard = result.querySelector(".lot-result__card");
  const resultText = result.querySelector(".lot-result__text");

  let stop = null;   // avbryter pågående animation
  let doneTimer = 0;

  function cancel() {
    stop?.();
    stop = null;
    clearTimeout(doneTimer);
    doneTimer = 0;
  }

  function setPhase(phase, stage) {
    root.dataset.phase = phase;
    root.dataset.method = stage?.method ?? "";
    root.dataset.result = phase === "result" && stage?.result != null ? stage.items[stage.result].label : "";
  }

  function hideResult() {
    result.hidden = true;
    result.classList.remove("is-pop", "is-fade");
  }

  function showResult(stage, how) {
    const it = stage.items[stage.result];
    const text = stage.kind === "names" ? `${it.label}!` : it.label;
    resultText.textContent = text;
    resultCard.classList.toggle("is-color", stage.kind === "colors");
    resultCard.style.setProperty("--lot-fill", it.color ?? "");
    resultCard.style.setProperty("--lot-fill-ink", it.color ? readableTextColor(it.color) : "");
    resultCard.style.setProperty("--lot-result-size", `${resultSize(text, stage.kind)}cqmin`);
    result.classList.remove("is-pop", "is-fade");
    result.hidden = false;
    if (how) {
      void result.offsetWidth; // starta om CSS-animationen
      result.classList.add(how);
    }
  }

  /** Bygg metodens vy (utan animation). Returnerar hjälpare för animationen. */
  function build(stage, { reelStart = stage.reelIndex, reelLand = 0 } = {}) {
    const { method, items, kind } = stage;
    if (method === "hjul") return buildWheel(show, items, kind);
    if (method === "rulle") return buildReel(show, items, kind, reelStart, reelLand);
    if (method === "lapp") return buildPile(show, items, kind);
    return buildDirect(show);
  }

  /** Stillastående scen: viloläge, eller landad med resultatet synligt. */
  function render(stage, { message = "" } = {}) {
    cancel();
    hideResult();
    msg.hidden = !message;
    msg.textContent = message;
    if (!stage || stage.items.length === 0) {
      show.replaceChildren();
      show.dataset.empty = "";
      setPhase("idle", stage);
      return;
    }
    delete show.dataset.empty;
    const view = build(stage);
    if (stage.method === "hjul") view.rotate(stage.angle);
    if (stage.result != null) {
      if (stage.method === "lapp") view.reveal(stage.items[stage.result], stage.kind);
      else showResult(stage);
      setPhase("result", stage);
    } else {
      setPhase("idle", stage);
    }
  }

  /**
   * Spela upp en dragning. offset = hur länge sedan den startade (ms) —
   * elevskärmen kommer in några ms efter läraren, och en sent öppnad
   * elevskärm hoppar direkt till resultatet.
   */
  function play(stage, draw, { offset = 0, onDone } = {}) {
    cancel();
    msg.hidden = true;
    delete show.dataset.empty;
    const duration = DURATION_MS[stage.method] ?? 0;
    const finish = (how) => {
      stop = null;
      if (stage.method === "lapp") {
        // Lappen ÄR resultatet — den står uppvänd stort i mitten.
      } else {
        showResult(stage, how);
      }
      setPhase("result", stage);
      doneTimer = setTimeout(() => onDone?.(), how ? RESULT_IN_MS : 0);
    };

    // Direkt, rörelsekänslig användare eller redan passerad: landa direkt (kort toning).
    if (duration === 0 || reducedMotion() || offset >= duration) {
      hideResult();
      const view = build(stage);
      if (stage.method === "hjul") view.rotate(stage.angle);
      if (stage.method === "lapp") view.reveal(stage.items[stage.result], stage.kind, { fade: offset < duration || duration === 0 });
      finish(offset >= duration && duration > 0 ? null : "is-fade");
      return;
    }

    hideResult();
    setPhase("drawing", stage);
    const view = build(stage, { reelStart: draw.start, reelLand: draw.land });
    let frame;
    if (stage.method === "hjul") {
      frame = (t) => view.rotate(lerp(draw.from, draw.to, easeOutQuart(t)));
    } else if (stage.method === "rulle") {
      frame = (t) => view.roll(draw.land * easeOutQuart(t));
    } else {
      frame = view.shuffle(draw.seed, stage.items[stage.result], stage.kind);
    }
    stop = timeline(duration, offset, frame, () => finish("is-pop"));
  }

  return { render, play, destroy: cancel };
}

/** Tidsstyrd animation: frame(t) med t 0→1 över duration ms. */
function timeline(duration, offset, frame, done) {
  const t0 = performance.now() - offset;
  let raf = 0;
  let over = false;
  const finish = () => {
    if (over) return;
    over = true;
    cancelAnimationFrame(raf);
    clearTimeout(timer);
    frame(1);
    done();
  };
  const step = (now) => {
    const t = Math.min(1, (now - t0) / duration);
    if (t >= 1) { finish(); return; }
    frame(t);
    raf = requestAnimationFrame(step);
  };
  // Reserv: rAF pausas i bakgrundsfönster — resultatet ska ändå komma i tid.
  const timer = setTimeout(finish, Math.max(0, duration - offset));
  frame(Math.min(1, offset / duration));
  raf = requestAnimationFrame(step);
  return () => { over = true; cancelAnimationFrame(raf); clearTimeout(timer); };
}

/** Resultattextens storlek (cqmin) — kortare text, större bokstäver. */
function resultSize(text, kind) {
  const len = [...text].length;
  const max = kind === "colors" ? 12 : 17;
  return clamp(95 / Math.max(1, len) * 1.6, 6, max);
}

// ---- Lyckohjulet ----------------------------------------------------------------

function sliceFill(items, i, kind) {
  if (kind === "colors" && items[i].color) return items[i].color;
  let c = PALETTE[i % PALETTE.length];
  // Sista biten får aldrig samma färg som den första (de ligger bredvid varandra).
  if (i > 0 && i === items.length - 1 && c === PALETTE[0]) c = PALETTE[(i + 1) % PALETTE.length];
  return c;
}

const polar = (deg, r) => {
  const a = (deg * Math.PI) / 180;
  return [r * Math.sin(a), -r * Math.cos(a)];
};

/**
 * Hjulet i en SVG (viewBox ±110, hjulets radie 100). Pilen sitter i
 * toppen och pekar nedåt. Texten står radiellt i varje bit, alltid med
 * rätt sida upp; storleken räknas ur bitens bredd och textens längd.
 * Får texten inte plats kortas den med "…" och hela texten ligger i en
 * <title> (tooltip).
 */
function buildWheel(show, items, kind) {
  const n = items.length;
  const s = 360 / n;
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "-110 -110 220 220");
  svg.setAttribute("class", "lot-wheel");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", `Lyckohjul med ${n} alternativ`);
  const rot = document.createElementNS(SVG_NS, "g");
  rot.setAttribute("class", "lot-wheel__rot");

  const AVAIL = 70;                                              // textens plats längs radien
  const arcFont = n === 1 ? 16 : Math.min(15, ((2 * Math.PI * 64) / n) * 0.6);
  const CH = 0.6;                                                // ungefärlig teckenbredd / fontstorlek
  let html = "";
  items.forEach((it, i) => {
    const fill = sliceFill(items, i, kind);
    const ink = readableTextColor(fill);
    let shape;
    if (n === 1) {
      shape = `<circle r="100" fill="${fill}"/>`;
    } else {
      const [x0, y0] = polar(i * s, 100);
      const [x1, y1] = polar((i + 1) * s, 100);
      shape = `<path d="M0 0L${x0.toFixed(3)} ${y0.toFixed(3)}A100 100 0 ${s > 180 ? 1 : 0} 1 ${x1.toFixed(3)} ${y1.toFixed(3)}Z" fill="${fill}"/>`;
    }
    const chars = [...it.label];
    let font = Math.min(arcFont, AVAIL / (CH * Math.max(chars.length, 1)));
    font = Math.max(font, Math.min(arcFont, 7));
    const maxChars = Math.max(2, Math.floor(AVAIL / (CH * font)));
    const cut = chars.length > maxChars;
    const text = cut ? `${chars.slice(0, maxChars - 1).join("").trimEnd()}…` : it.label;
    const title = cut ? `<title>${escapeHtml(it.label)}</title>` : "";
    let label;
    if (n === 1) {
      label = `<text x="0" y="0" text-anchor="middle" dominant-baseline="central" font-size="${font.toFixed(2)}" fill="${ink}">${escapeHtml(text)}</text>`;
    } else {
      const mid = (i + 0.5) * s;
      const right = mid <= 180; // högra halvan: läs utåt; vänstra: läs inåt (rätt sida upp)
      label = `<g transform="rotate(${(right ? mid - 90 : mid + 90).toFixed(3)})">
        <text x="${right ? 94 : -94}" y="0" text-anchor="${right ? "end" : "start"}" dominant-baseline="central"
          font-size="${font.toFixed(2)}" fill="${ink}">${escapeHtml(text)}</text></g>`;
    }
    html += `<g class="lot-slice" data-index="${i}">${title}${shape}${label}</g>`;
  });
  rot.innerHTML = html;
  svg.append(rot);
  const fixed = document.createElementNS(SVG_NS, "g");
  fixed.innerHTML = `
    <circle r="100" class="lot-wheel__rim"/>
    <circle r="9" class="lot-wheel__hub"/>
    <path d="M-8 -109L8 -109L0 -89Z" class="lot-wheel__pointer"/>`;
  svg.append(fixed);
  show.replaceChildren(svg);
  return {
    rotate(deg) { rot.setAttribute("transform", `rotate(${deg.toFixed(3)})`); },
  };
}

// ---- Namnrullen -------------------------------------------------------------------

/**
 * Enarmad bandit: fem rader syns, den mittersta är markerad. Raderna är
 * alternativen i ordning med start i `start`; rullen går från rad 0 till
 * rad `land`. Positionen styrs med CSS-variabeln --pos (i rader).
 */
function buildReel(show, items, kind, start, land) {
  const n = items.length;
  const wrap = document.createElement("div");
  wrap.className = "lot-reel";
  const rows = [];
  for (let k = -3; k <= land + 3; k++) {
    const it = items[reelItemAt(n, start, k)];
    const sw = kind === "colors" && it.color ? `<span class="lot-reel__swatch" style="background:${it.color}"></span>` : "";
    rows.push(`<div class="lot-reel__row">${sw}<span class="lot-reel__text">${escapeHtml(it.label)}</span></div>`);
  }
  wrap.innerHTML = `
    <div class="lot-reel__window">
      <div class="lot-reel__strip">${rows.join("")}</div>
      <div class="lot-reel__shade lot-reel__shade--top"></div>
      <div class="lot-reel__shade lot-reel__shade--bottom"></div>
      <div class="lot-reel__mark"></div>
    </div>`;
  const strip = wrap.querySelector(".lot-reel__strip");
  const roll = (pos) => strip.style.setProperty("--pos", (pos + 3).toFixed(4));
  roll(0);
  show.replaceChildren(wrap);
  return { roll };
}

// ---- Dra en lapp -------------------------------------------------------------------

function pileLayout(count) {
  const m = Math.min(count, PILE_MAX);
  const rnd = seededRandom(PILE_SEED);
  const cols = m <= 4 ? m : m <= 6 ? 3 : 4;
  const rowsN = Math.ceil(m / cols);
  const pos = [];
  for (let i = 0; i < m; i++) {
    const c = i % cols;
    const r = Math.floor(i / cols);
    const inRow = r === rowsN - 1 ? m - r * cols : cols; // sista raden centreras
    pos.push({
      x: 50 + (c - (inRow - 1) / 2) * 19 + (rnd() - 0.5) * 4,
      y: 50 + (r - (rowsN - 1) / 2) * 27 + (rnd() - 0.5) * 5,
      r: (rnd() - 0.5) * 22,
    });
  }
  return pos;
}

function noteFront(el, item, kind) {
  const front = el.querySelector(".lot-note__front");
  const span = front.querySelector("span");
  span.textContent = item.label;
  const len = [...item.label].length;
  front.style.setProperty("--lot-note-size", `${clamp(3.6 * 7 / Math.max(len, 7), 1.5, 3.6).toFixed(2)}cqmin`);
  if (kind === "colors" && item.color) {
    front.style.background = item.color;
    front.style.color = readableTextColor(item.color);
    front.classList.add("is-color");
  }
}

/**
 * Lapparna ligger vikta i en hög. shuffle(): de dras ihop och skakas, byter
 * plats, en lapp glider fram till mitten och vänds upp stort. Allt ur fröet.
 */
function buildPile(show, items, kind) {
  const base = pileLayout(items.length);
  const wrap = document.createElement("div");
  wrap.className = "lot-pile";
  const noteHtml = `<div class="lot-note"><div class="lot-note__inner">
      <div class="lot-note__back">${icon("note", { size: 40, strokeWidth: 1.2 })}</div>
      <div class="lot-note__front"><span></span></div></div></div>`;
  wrap.innerHTML = base.map(() => noteHtml).join("");
  const notes = [...wrap.children];
  const place = (el, x, y, r, scale = 1, flip = 0, opacity = 1) => {
    el.style.left = `${x}%`;
    el.style.top = `${y}%`;
    el.style.transform = `translate(-50%, -50%) rotate(${r.toFixed(2)}deg) scale(${scale.toFixed(3)})`;
    el.style.opacity = String(opacity);
    el.firstElementChild.style.transform = `rotateY(${flip.toFixed(1)}deg)`;
  };
  notes.forEach((el, i) => place(el, base[i].x, base[i].y, base[i].r));
  show.replaceChildren(wrap);

  /** Den dragna lappen uppvänd i mitten (landat läge). */
  function reveal(item, k, { fade = false } = {}) {
    notes.forEach((el, i) => place(el, base[i].x, base[i].y, base[i].r, 1, 0, 0.3));
    const big = notes[0].cloneNode(true);
    big.classList.add("is-drawn");
    if (fade) big.classList.add("is-fade");
    noteFront(big, item, k);
    wrap.append(big);
    place(big, 50, 50, 0, BIG_NOTE, 180, 1);
  }

  function shuffle(seed, item, k) {
    const rnd = seededRandom(seed);
    const m = notes.length;
    // Ny ordning efter blandningen (Fisher–Yates ur fröet).
    const perm = base.map((_, i) => i);
    for (let i = m - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [perm[i], perm[j]] = [perm[j], perm[i]];
    }
    const wob = notes.map(() => ({ ph: rnd() * Math.PI * 2, f: 5 + rnd() * 3, a: 10 + rnd() * 8 }));
    const pick = Math.floor(rnd() * m);
    noteFront(notes[pick], item, k);
    notes[pick].classList.add("is-drawn");
    const A = 0.42; // blanda
    const B = 0.72; // fram till mitten; därefter vänd

    return (t) => {
      notes.forEach((el, i) => {
        const from = base[i];
        const to = base[perm[i]];
        if (t < A) {
          const u = t / A;
          const g = Math.sin(Math.PI * u) * 0.7; // dras ihop mot mitten och ut igen
          const bx = lerp(from.x, to.x, easeInOut(u));
          const by = lerp(from.y, to.y, easeInOut(u));
          const w = wob[i];
          const shake = Math.sin(Math.PI * u);
          place(el, lerp(bx, 50, g) + Math.sin(u * w.f * Math.PI + w.ph) * 1.6 * shake,
            lerp(by, 50, g) + Math.cos(u * w.f * Math.PI + w.ph) * 1.6 * shake,
            lerp(from.r, to.r, u) + Math.sin(u * w.f * 2 * Math.PI + w.ph) * w.a * shake);
        } else if (i !== pick) {
          const u = clamp((t - A) / (B - A), 0, 1);
          place(el, to.x, to.y, to.r, 1, 0, lerp(1, 0.3, u));
        } else if (t < B) {
          const u = easeOutCubic((t - A) / (B - A));
          place(el, lerp(to.x, 50, u), lerp(to.y, 50, u), lerp(to.r, 0, u), lerp(1, BIG_NOTE, u));
        } else {
          const u = easeInOut((t - B) / (1 - B));
          place(el, 50, 50, 0, BIG_NOTE, 180 * u);
        }
      });
      if (t >= A) notes[pick].style.zIndex = "5";
    };
  }

  return { reveal, shuffle };
}

// ---- Direkt -----------------------------------------------------------------------

function buildDirect(show) {
  const card = document.createElement("div");
  card.className = "lot-direct";
  card.innerHTML = `<span aria-hidden="true">?</span>`;
  show.replaceChildren(card);
  return {};
}
