/**
 * TANKEKARTANS LAYOUT (issue #53) — ren geometri, ingen DOM.
 *
 * Molnet står i mitten, bubblorna runt om. Allt räknas i en VIRTUELL
 * scen med konstant yta (SCENE_AREA) och skärmens/papperets bildformat:
 * samma karta och samma bildformat ger alltså exakt samma layout, oavsett
 * om den visas i lärarens förhandsvisning, på projektorn i 1920×1080
 * eller 1280×720 — scenen skalas bara som helhet (js/modes/karta/scene.js).
 *
 * Gången (layoutMap):
 *   1. Bubblorna står i skapandeordning, medurs från toppen, med jämna
 *      vinklar på en, två eller tre elliptiska ringar runt molnet (högst
 *      9 → en ring). Grannar i vinkel står på olika ringar, så en yttre
 *      bubblas kurva går mellan två inre. Ringarna anpassas efter de
 *      faktiska bubblornas bredd/höjd: närmast molnet utan att röra det,
 *      längst ut utan att gå utanför scenen.
 *   2. En avslappning knuffar isär det som fortfarande överlappar (längs
 *      den axel där överlappet är minst), ut ur molnets ellips och in i
 *      scenen. Fästa bubblor (dragna av läraren) står still.
 *   3. Går det inte utan överlapp krymps texten stegvis (och molnet lite
 *      grann) tills allt ryms. Med många bubblor är molnet redan från
 *      början något mindre.
 *
 * Deterministiskt: ingen slump — elevskärmen och läraren får samma bild.
 */

/** Den virtuella scenens yta (px²): 1600 × 900 vid 16:9. */
export const SCENE_AREA = 1600 * 900;

/** Textstorlek (virtuella px) efter antal bubblor — som originalet: färre = större. */
export function baseFontFor(n) {
  if (n <= 8) return 32;
  if (n <= 14) return 27;
  return 23;
}

/** Den virtuella scenens mått för ett bildformat (bredd / höjd). */
export function sceneSize(aspect) {
  const ar = Number.isFinite(aspect) && aspect > 0.2 && aspect < 5 ? aspect : 16 / 9;
  return { w: Math.sqrt(SCENE_AREA * ar), h: Math.sqrt(SCENE_AREA / ar) };
}

const SCALES = [1, 0.93, 0.86, 0.8, 0.74, 0.68, 0.62, 0.57, 0.52, 0.47, 0.42, 0.38, 0.34];

/**
 * @param {object} p
 * @param {number} p.w,p.h              scenens mått (virtuella px)
 * @param {{rx:number, ry:number}} p.cloud  molnets ellips (halvaxlar) vid skala 1
 * @param {Array<{w:number,h:number,pin?:{x:number,y:number}}>} p.bubbles
 *        bubblornas mått vid skala 1; pin = fäst plats som andel (0–1) av scenen
 * @param {number} [p.margin]           luft mot scenens kant
 * @param {number} [p.gap]              minsta luft mellan två bubblor / bubbla–moln
 * @returns {{scale:number, cloudScale:number, ok:boolean,
 *            items: Array<{x:number,y:number,w:number,h:number}>}}
 *          x,y = bubblans MITTPUNKT i scenen (origo uppe till vänster)
 */
export function layoutMap({ w, h, cloud, bubbles, margin = 22, gap = 16 }) {
  let last = null;
  // Trångt (många bubblor): molnet ger plats — högst 22 % mindre vid 30.
  const n = bubbles.length;
  const crowd = n <= 12 ? 1 : Math.max(0.78, 1 - (n - 12) * 0.012);
  for (const scale of SCALES) {
    const cloudScale = Math.max(0.55, Math.min(crowd, Math.sqrt(scale)));
    const c = { rx: cloud.rx * cloudScale, ry: cloud.ry * cloudScale };
    const sized = bubbles.map((b) => ({ w: b.w * scale, h: b.h * scale, pin: b.pin ?? null }));
    for (const rings of ringOptions(sized.length)) {
      const items = placeRings({ w, h, cloud: c, bubbles: sized, rings, margin, gap });
      relax({ w, h, cloud: c, items, margin, gap });
      const ok = isClean({ w, h, cloud: c, items, margin, gap: gap * 0.5 });
      last = { scale, cloudScale, ok, items: items.map(({ x, y, w: bw, h: bh }) => ({ x, y, w: bw, h: bh })) };
      if (ok) return last;
    }
  }
  return last ?? { scale: 1, cloudScale: 1, ok: true, items: [] };
}

/** Antal ringar att pröva, bäst först. */
function ringOptions(n) {
  if (n <= 1) return [1];
  if (n <= 9) return [1, 2];
  if (n <= 18) return [2, 3];
  return [3, 2];
}

/**
 * Ringen för bubbla nr i (i vinkelordning). Grannar i vinkel står alltid
 * på OLIKA ringar — en yttre bubblas kurva går då mellan två inre.
 */
const RING_PATTERN = { 1: [0], 2: [0, 1], 3: [0, 2, 1] };

/** Steg 1: bubblorna på elliptiska ringar. */
function placeRings({ w, h, cloud, bubbles, rings, margin, gap }) {
  const cx = w / 2;
  const cy = h / 2;
  const items = bubbles.map((b) => ({ ...b, x: cx, y: cy, fixed: false }));

  // Fästa bubblor står där läraren ställde dem (inom scenen).
  const free = [];
  for (const it of items) {
    if (it.pin) {
      it.x = clamp(it.pin.x * w, margin + it.w / 2, w - margin - it.w / 2);
      it.y = clamp(it.pin.y * h, margin + it.h / 2, h - margin - it.h / 2);
      it.fixed = true;
    } else {
      free.push(it);
    }
  }
  const n = free.length;
  if (n === 0) return items;

  const R = Math.min(rings, n);
  const pattern = RING_PATTERN[R] ?? RING_PATTERN[1];
  const ringOf = free.map((_, i) => pattern[i % pattern.length]);

  const maxW = Math.max(...free.map((b) => b.w));
  const maxH = Math.max(...free.map((b) => b.h));
  const rxOut = Math.max(0, w / 2 - margin - maxW / 2);
  const ryOut = Math.max(0, h / 2 - margin - maxH / 2);
  // Hur långt ut den yttersta ringen går: få bubblor → närmare molnet.
  const reach = R === 1 ? Math.min(1, 0.35 + n * 0.08) : Math.min(1, 0.5 + n * 0.025);

  const radii = [];
  for (let r = 0; r < R; r++) {
    const ring = free.filter((_, i) => ringOf[i] === r);
    const rw = Math.max(...ring.map((b) => b.w));
    const rh = Math.max(...ring.map((b) => b.h));
    const rxIn = cloud.rx + gap + rw / 2;
    const ryIn = cloud.ry + gap + rh / 2;
    const t = R === 1 ? reach : (r / (R - 1)) * reach;
    radii.push({
      rx: Math.min(rxOut, rxIn) + Math.max(0, rxOut - rxIn) * t,
      ry: Math.min(ryOut, ryIn) + Math.max(0, ryOut - ryIn) * t,
    });
  }

  // Jämna vinklar i skapandeordning, medurs från toppen.
  free.forEach((it, i) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    const { rx, ry } = radii[ringOf[i]];
    it.x = cx + rx * Math.cos(a);
    it.y = cy + ry * Math.sin(a);
  });
  return items;
}

/** Steg 2: knuffa isär överlapp, ut ur molnet och in i scenen. */
function relax({ w, h, cloud, items, margin, gap }) {
  const n = items.length;
  for (let iter = 0; iter < 400; iter++) {
    let moved = 0;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = items[i];
        const b = items[j];
        if (a.fixed && b.fixed) continue;
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        const ox = (a.w + b.w) / 2 + gap - Math.abs(dx);
        const oy = (a.h + b.h) / 2 + gap - Math.abs(dy);
        if (ox <= 0 || oy <= 0) continue;
        if (dx === 0 && dy === 0) { dx = i % 2 ? 1 : -1; dy = 0.5; }
        // Längs den axel där överlappet är minst (i förhållande till storleken).
        let px = 0;
        let py = 0;
        if (ox / (a.w + b.w) < oy / (a.h + b.h)) px = Math.sign(dx || 1) * (ox + 0.5);
        else py = Math.sign(dy || 1) * (oy + 0.5);
        const shareA = a.fixed ? 0 : b.fixed ? 1 : 0.5;
        const shareB = 1 - shareA;
        a.x -= px * shareA; a.y -= py * shareA;
        b.x += px * shareB; b.y += py * shareB;
        moved++;
      }
    }
    for (const it of items) {
      if (it.fixed) continue;
      moved += pushOutOfCloud(it, w / 2, h / 2, cloud, gap) ? 1 : 0;
      const x = clamp(it.x, margin + it.w / 2, w - margin - it.w / 2);
      const y = clamp(it.y, margin + it.h / 2, h - margin - it.h / 2);
      if (x !== it.x || y !== it.y) { it.x = x; it.y = y; }
    }
    if (moved === 0) return;
  }
}

/** Närmaste punkt i rektangeln (runt mittpunkten) till molnets mitt, relativt mitten. */
function nearestRectPoint(it, cx, cy, pad) {
  const hw = it.w / 2 + pad;
  const hh = it.h / 2 + pad;
  return {
    x: clamp(cx, it.x - hw, it.x + hw) - cx,
    y: clamp(cy, it.y - hh, it.y + hh) - cy,
  };
}

/** Ligger rektangeln (med luft) inne i molnets ellips? */
function hitsCloud(it, cx, cy, cloud, pad) {
  const p = nearestRectPoint(it, cx, cy, pad);
  // Rektangelns närmaste punkt inne i ellipsen ⇒ överlapp (ellipsen är konvex,
  // och mitten ligger utanför rektangeln i praktiken — annars är p = 0 ⇒ träff).
  if ((p.x * p.x) / (cloud.rx * cloud.rx) + (p.y * p.y) / (cloud.ry * cloud.ry) < 1) return true;
  // Hörnet närmast mitten kan ligga utanför ellipsen medan en kant skär den:
  // kontrollera kanterna mot ellipsen i några punkter.
  const hw = it.w / 2 + pad;
  const hh = it.h / 2 + pad;
  for (let k = 0; k <= 8; k++) {
    const f = k / 8;
    for (const [x, y] of [
      [it.x - hw + 2 * hw * f, it.y - hh], [it.x - hw + 2 * hw * f, it.y + hh],
      [it.x - hw, it.y - hh + 2 * hh * f], [it.x + hw, it.y - hh + 2 * hh * f],
    ]) {
      const ex = (x - cx) / cloud.rx;
      const ey = (y - cy) / cloud.ry;
      if (ex * ex + ey * ey < 1) return true;
    }
  }
  return false;
}

function pushOutOfCloud(it, cx, cy, cloud, gap) {
  if (!hitsCloud(it, cx, cy, cloud, gap)) return false;
  let dx = it.x - cx;
  let dy = it.y - cy;
  const len = Math.hypot(dx, dy) || 1;
  if (len < 1e-6) { dx = 0; dy = -1; }
  const step = Math.max(2, Math.min(it.w, it.h) * 0.08);
  for (let k = 0; k < 200 && hitsCloud(it, cx, cy, cloud, gap); k++) {
    it.x += (dx / len) * step;
    it.y += (dy / len) * step;
  }
  return true;
}

/** Steg 3: är layouten fri från överlapp och inom scenen? */
export function isClean({ w, h, cloud, items, margin = 0, gap = 0 }) {
  const eps = 0.5;
  for (const it of items) {
    if (it.x - it.w / 2 < margin - eps || it.x + it.w / 2 > w - margin + eps) return false;
    if (it.y - it.h / 2 < margin - eps || it.y + it.h / 2 > h - margin + eps) return false;
    if (cloud && hitsCloud(it, w / 2, h / 2, cloud, gap)) return false;
  }
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i];
      const b = items[j];
      if (Math.abs(a.x - b.x) < (a.w + b.w) / 2 + gap - eps && Math.abs(a.y - b.y) < (a.h + b.h) / 2 + gap - eps) return false;
    }
  }
  return true;
}

/**
 * Kopplingen från molnets mitt till en bubbla: en mjuk kvadratisk
 * Bézierkurva som böjer av åt samma håll runt hela kartan (som en virvel).
 * → SVG-pathens d.
 */
export function linkPath(x0, y0, x1, y1) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy) || 1;
  const bend = Math.min(60, len * 0.14);
  const qx = x0 + dx / 2 - (dy / len) * bend;
  const qy = y0 + dy / 2 + (dx / len) * bend;
  const r = (v) => Math.round(v * 10) / 10;
  return `M${r(x0)} ${r(y0)} Q${r(qx)} ${r(qy)} ${r(x1)} ${r(y1)}`;
}

/**
 * Molnets kontur: en ellips med mjuka "puffar" (bågar) runt om.
 * rx, ry = den yttre ellips som bubblorna ska hålla sig utanför.
 * → { d, bump } där bump är puffarnas höjd (konturen ligger inom rx, ry).
 */
export function cloudPath(cx, cy, rx, ry) {
  const bump = Math.min(rx, ry) * 0.2;
  const ax = rx - bump;
  const ay = ry - bump;
  // Antal puffar efter omkretsen (Ramanujan), jämnt antal för symmetri.
  const perim = Math.PI * (3 * (ax + ay) - Math.sqrt((3 * ax + ay) * (ax + 3 * ay)));
  let k = Math.max(8, Math.round(perim / (bump * 4.2)));
  if (k % 2) k++;
  const pts = [];
  for (let i = 0; i < k; i++) {
    // Lätt växlande puffar — organiskt men symmetriskt och deterministiskt.
    const t = (i / k) * 2 * Math.PI + (i % 2 ? 0.06 : -0.06) * (2 * Math.PI / k);
    pts.push([cx + ax * Math.cos(t), cy + ay * Math.sin(t)]);
  }
  const r = (v) => Math.round(v * 10) / 10;
  let d = `M${r(pts[0][0])} ${r(pts[0][1])}`;
  for (let i = 0; i < k; i++) {
    const [x1, y1] = pts[(i + 1) % k];
    const [x0, y0] = pts[i];
    const chord = Math.hypot(x1 - x0, y1 - y0);
    // Radie så att bågens höjd ≈ bump (sagitta s: R = c²/8s + s/2).
    const s = Math.min(bump, chord * 0.48);
    const R = (chord * chord) / (8 * s) + s / 2;
    d += ` A${r(R)} ${r(R)} 0 0 1 ${r(x1)} ${r(y1)}`;
  }
  return { d: `${d} Z`, bump };
}

function clamp(v, lo, hi) {
  if (hi < lo) return (lo + hi) / 2;
  return Math.min(hi, Math.max(lo, v));
}
