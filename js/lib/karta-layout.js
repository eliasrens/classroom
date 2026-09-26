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
 *      bubblas kurva går mellan två inre. Varje bubbla flyttas ut längs
 *      sin egen stråle efter sin egen bredd/höjd: innersta ringen närmast
 *      molnet utan att röra det, yttersta längst ut utan att gå utanför
 *      scenen — så fungerar det även i smala (stående) format.
 *   2. En avslappning knuffar isär det som fortfarande överlappar (längs
 *      den axel där överlappet är minst), ut ur molnets ellips och in i
 *      scenen. Fästa bubblor (dragna av läraren) står still.
 *   3. Går det inte utan överlapp krymps texten stegvis (och molnet lite
 *      grann) tills allt ryms. Med många bubblor är molnet redan från
 *      början något mindre.
 *
 * Grenar (issue #59): en bubbla kan ha under-bubblor (parent = index).
 * Då används en RADIELL TRÄDLAYOUT (placeTree) i stället för ringarna:
 *   - varje huvudbubbla får en vinkelsektor efter hur många "löv" dess
 *     gren har (en ensam bubbla = 1), i skapandeordning medurs från toppen;
 *     utan grenar blir sektorerna lika stora — samma vinklar som ringarna
 *   - en grens barn delar förälderns sektor (högst ~26° per barn, runt
 *     förälderns vinkel) — en solfjäder utåt i förälderns riktning
 *   - nivå 1 står närmast molnet, den djupaste nivån längst ut; varannan
 *     bubbla på den yttersta nivån kan stå en bit in (två "halvringar")
 *   - barn till en FÄST (dragen) bubbla fläktar ut runt den, bort från
 *     molnet, så att en dragen gren följer med sin förälder
 *   Sedan samma avslappning och samma krympning som utan grenar.
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
 * @param {Array<{w:number,h:number,pin?:{x:number,y:number},parent?:number}>} p.bubbles
 *        bubblornas mått vid skala 1; pin = fäst plats som andel (0–1) av scenen;
 *        parent = förälderns index i listan (saknas/-1 = runt molnet)
 * @param {number} [p.margin]           luft mot scenens kant
 * @param {number} [p.gap]              minsta luft mellan två bubblor / bubbla–moln
 * @returns {{scale:number, cloudScale:number, ok:boolean,
 *            items: Array<{x:number,y:number,w:number,h:number}>}}
 *          x,y = bubblans MITTPUNKT i scenen (origo uppe till vänster)
 */
export function layoutMap({ w, h, cloud, bubbles, margin = 22, gap = 16 }) {
  let last = null;
  let fallback = null;
  // Trångt (många bubblor): molnet ger plats — högst 22 % mindre vid 30.
  // Smalt format (stående papper): molnet får aldrig ta mer än ~46 % av
  // bredden, annars ryms inga bubblor bredvid det.
  const n = bubbles.length;
  const crowd = Math.min(
    n <= 12 ? 1 : Math.max(0.78, 1 - (n - 12) * 0.012),
    (w * 0.23) / Math.max(1, cloud.rx),
  );
  const tree = buildTree(bubbles);
  const variants = tree.depth > 1 ? treeVariants(tree) : ringOptions(n);
  for (const scale of SCALES) {
    const cloudScale = Math.max(0.45, Math.min(crowd, Math.sqrt(scale)));
    const c = { rx: cloud.rx * cloudScale, ry: cloud.ry * cloudScale };
    const sized = bubbles.map((b) => ({ w: b.w * scale, h: b.h * scale, pin: b.pin ?? null }));
    // Med grenar: hoppa över skalor som uppenbart inte ryms (bubblornas yta
    // mot den fria ytan) — avslappningen är det som kostar.
    if (tree.depth > 1 && scale !== SCALES.at(-1) && fillRatio({ w, h, cloud: c, bubbles: sized, margin, gap }) > FILL_MAX) continue;
    for (const v of variants) {
      const items = tree.depth > 1
        ? placeTree({ w, h, cloud: c, bubbles: sized, tree, variant: v, margin, gap })
        : placeRings({ w, h, cloud: c, bubbles: sized, rings: v, margin, gap });
      const start = items.map((it) => ({ x: it.x, y: it.y }));
      relax({ w, h, cloud: c, items, margin, gap, stuck: tree.depth > 1 });
      const ok = isClean({ w, h, cloud: c, items, margin, gap: gap * 0.5 });
      last = { scale, cloudScale, ok, items: items.map(({ x, y, w: bw, h: bh }) => ({ x, y, w: bw, h: bh })) };
      if (!ok) continue;
      if (tree.depth <= 1) return last;
      // Med grenar: en layout där avslappningen fått flytta en bubbla långt
      // från sin plats i trädet (grenen hamnar hos grannen, kurvorna korsas)
      // godtas bara om inget bättre finns — hellre lite mindre text.
      last.drift = drift(items, start);
      if (last.drift <= DRIFT_MAX) return last;
      if (!fallback) fallback = last;
    }
  }
  return fallback ?? last ?? { scale: 1, cloudScale: 1, ok: true, items: [] };
}

const DRIFT_MAX = 0.9;

/** Största förflyttningen i avslappningen, i förhållande till bubblans egen storlek. */
function drift(items, start) {
  let worst = 0;
  items.forEach((it, i) => {
    if (it.fixed) return;
    worst = Math.max(worst, Math.hypot(it.x - start[i].x, it.y - start[i].y) / (it.w + it.h));
  });
  return worst;
}

/**
 * Trädet ur parent-indexen. Ogiltiga föräldrar (utanför listan, sig själv,
 * en slinga) räknas som huvudnivå.
 * → { parent[], children[][], roots[], level[] (1 = huvudnivå), depth }
 */
export function buildTree(bubbles) {
  const n = bubbles.length;
  const parent = bubbles.map((b, i) => {
    const p = Number.isInteger(b.parent) ? b.parent : -1;
    return p >= 0 && p < n && p !== i ? p : -1;
  });
  // Slingor: gå uppåt; kommer vi tillbaka till en redan besökt nod på samma väg → bryt.
  for (let i = 0; i < n; i++) {
    const seen = new Set([i]);
    let k = parent[i];
    while (k >= 0) {
      if (seen.has(k)) { parent[i] = -1; break; }
      seen.add(k);
      k = parent[k];
    }
  }
  const children = bubbles.map(() => []);
  const roots = [];
  parent.forEach((p, i) => (p < 0 ? roots : children[p]).push(i));
  const level = new Array(n).fill(1);
  const visit = (i, l) => { level[i] = l; for (const c of children[i]) visit(c, l + 1); };
  for (const r of roots) visit(r, 1);
  return { parent, children, roots, level, depth: n ? Math.max(...level) : 0 };
}

/**
 * Trädlayoutens varianter, bäst först:
 *   reach = hur långt ut (andel av vägen molnet → kanten) den djupaste nivån står
 *   f1    = var huvudnivån står (0 = tätt intill molnet)
 *   alt   = hur långt in varannan bubbla på den djupaste nivån flyttas
 *   alt1  = hur långt UT varannan huvudbubbla flyttas (många huvudbubblor)
 */
function treeVariants(tree) {
  const n = tree.level.length;
  const reach = Math.min(1, 0.4 + n * 0.03);
  const out = [
    { greedy: true, pad: 0 },
    { greedy: true, pad: 10 },
    { reach, f1: 0, alt: 0, alt1: 0 },
    { reach: 1, f1: 0.12, alt: 0.34, alt1: 0 },
  ];
  if (tree.roots.length > 5) out.push({ reach: 1, f1: 0.1, alt: 0.4, alt1: 0.28 });
  return out;
}

const CHILD_SPAN = 0.46; // högsta vinkel (rad) per barn i en solfjäder

/** Steg 1 med grenar: radiell trädlayout (se överst). */
function placeTree({ w, h, cloud, bubbles, tree, variant, margin, gap }) {
  const cx = w / 2;
  const cy = h / 2;
  const n = bubbles.length;
  const items = bubbles.map((b) => ({ ...b, x: cx, y: cy, fixed: false }));
  const { children, roots, level, depth } = tree;

  for (const it of items) {
    if (!it.pin) continue;
    it.x = clamp(it.pin.x * w, margin + it.w / 2, w - margin - it.w / 2);
    it.y = clamp(it.pin.y * h, margin + it.h / 2, h - margin - it.h / 2);
    it.fixed = true;
  }

  // Sektorernas vikt: antal löv i den radiella delen av grenen. En fäst
  // bubbla (och allt under den) tar ingen sektor — den fläktar själv.
  const weight = new Array(n).fill(0);
  const weigh = (i) => {
    if (items[i].fixed) { for (const c of children[i]) weigh(c); return 0; }
    let s = 0;
    for (const c of children[i]) s += weigh(c);
    weight[i] = Math.max(1, s);
    return weight[i];
  };
  let total = 0;
  for (const r of roots) total += weigh(r);

  // Vinklar: huvudnivån delar hela varvet, barnen förälderns sektor.
  const angle = new Array(n).fill(null);
  const assign = (list, from, to) => {
    const free = list.filter((i) => !items[i].fixed);
    const sum = free.reduce((s, i) => s + weight[i], 0) || 1;
    let a = from;
    for (const i of free) {
      const span = ((to - from) * weight[i]) / sum;
      angle[i] = a + span / 2;
      const kids = children[i].filter((c) => !items[c].fixed);
      if (kids.length) {
        const width = Math.min(span, kids.length * CHILD_SPAN);
        assign(children[i], angle[i] - width / 2, angle[i] + width / 2);
      }
      a += span;
    }
  };
  if (total > 0) {
    const firstRoot = roots.find((i) => !items[i].fixed);
    const unit = (2 * Math.PI) / total;
    const start = -Math.PI / 2 - (firstRoot != null ? weight[firstRoot] * unit : 0) / 2;
    assign(roots, start, start + 2 * Math.PI);
  }

  const radial = [];
  for (let i = 0; i < n; i++) if (angle[i] != null) radial.push(i);
  if (variant.greedy) placeGreedy({ items, radial, angle, level, w, h, cx, cy, cloud, margin, gap: gap + variant.pad });
  else placeLevels({ items, radial, angle, level, depth, variant, w, h, cx, cy, cloud, margin, gap });
  placeFans({ items, children, roots, w, h, cx, cy, margin, gap });
  return items;
}

/**
 * Radiella noder, girigt: nivå för nivå, i vinkelordning, flyttas varje
 * bubbla ut längs sin stråle från molnet tills den inte rör något som
 * redan står (fästa bubblor, föräldern, grannarna). Ryms den inte hela
 * vägen ut står den där den överlappar minst — avslappningen tar resten.
 */
function placeGreedy({ items, radial, angle, level, w, h, cx, cy, cloud, margin, gap }) {
  const placed = items.filter((it) => it.fixed);
  const overlap = (a) => {
    let sum = 0;
    for (const b of placed) {
      const ox = (a.w + b.w) / 2 + gap - Math.abs(a.x - b.x);
      const oy = (a.h + b.h) / 2 + gap - Math.abs(a.y - b.y);
      if (ox > 0 && oy > 0) sum += ox * oy;
    }
    return sum;
  };
  const order = [...radial].sort((a, b) => level[a] - level[b] || angle[a] - angle[b]);
  for (const i of order) {
    const it = items[i];
    const ray = rayFor(angle[i], w, h);
    const { tMin, tMax } = rayRange({ it, ray, cx, cy, w, h, cloud, margin, gap });
    const step = Math.max(4, Math.min(it.w, it.h) * 0.2);
    let best = null;
    for (let t = tMin; ; t = Math.min(tMax, t + step)) {
      const cand = { x: cx + ray.dx * t, y: cy + ray.dy * t, w: it.w, h: it.h };
      const o = overlap(cand);
      if (!best || o < best.o) best = { t, o };
      if (o === 0 || t >= tMax) break;
    }
    const t = tMin >= tMax ? tMax : best.t;
    it.x = cx + ray.dx * t;
    it.y = cy + ray.dy * t;
    placed.push(it);
  }
}

/** Radiella noder efter nivå: huvudnivån intill molnet, den djupaste längst ut. */
function placeLevels({ items, radial, angle, level, depth, variant, w, h, cx, cy, cloud, margin, gap }) {
  const { reach, f1, alt, alt1 } = variant;
  const atLevel = new Map();
  [...radial].sort((a, b) => angle[a] - angle[b]).forEach((i) => {
    const l = level[i];
    atLevel.set(l, (atLevel.get(l) ?? 0) + 1);
    const k = atLevel.get(l) - 1; // ordning i vinkel på sin nivå
    const lo = f1 * reach;
    let f = depth > 1 ? lo + ((l - 1) / (depth - 1)) * (reach - lo) : 0;
    if (l === depth && alt && k % 2 === 1) f = Math.max(lo, f - alt * reach);
    if (l === 1 && alt1 && k % 2 === 1) f += alt1 * reach;
    const it = items[i];
    const ray = rayFor(angle[i], w, h);
    const { tMin, tMax } = rayRange({ it, ray, cx, cy, w, h, cloud, margin, gap });
    const t = tMin >= tMax ? tMax : tMin + (tMax - tMin) * f;
    it.x = cx + ray.dx * t;
    it.y = cy + ray.dy * t;
  });
}

/**
 * Barn till fästa bubblor (och deras barn): solfjäder runt föräldern,
 * bort från molnet. I trädordning, så att föräldern alltid står först.
 */
function placeFans({ items, children, roots, w, h, cx, cy, margin, gap }) {
  const fan = (i, inFan) => {
    const kids = children[i].filter((c) => !items[c].fixed && (inFan || items[i].fixed));
    const p = items[i];
    if (kids.length) {
      let dx = p.x - cx;
      let dy = p.y - cy;
      const len = Math.hypot(dx, dy) || 1;
      if (len < 1e-6) { dx = 0; dy = -1; } else { dx /= len; dy /= len; }
      const base = Math.atan2(dy, dx);
      kids.forEach((c, j) => {
        const it = items[c];
        const a = base + (j - (kids.length - 1) / 2) * 0.62;
        const dist = Math.hypot(p.w, p.h) / 2 + Math.hypot(it.w, it.h) / 2 + gap;
        it.x = clamp(p.x + Math.cos(a) * dist, margin + it.w / 2, w - margin - it.w / 2);
        it.y = clamp(p.y + Math.sin(a) * dist, margin + it.h / 2, h - margin - it.h / 2);
      });
    }
    for (const c of children[i]) fan(c, inFan || kids.includes(c));
  };
  for (const r of roots) fan(r, false);
}

/** Strålen för en vinkel — följer scenens form (en ellips i scenens proportioner). */
function rayFor(a, w, h) {
  const dx = Math.cos(a) * w;
  const dy = Math.sin(a) * h;
  const len = Math.hypot(dx, dy) || 1;
  return { dx: dx / len, dy: dy / len };
}

/** Längs en stråle: närmast molnet (utan att röra det) och längst ut i scenen. */
function rayRange({ it, ray, cx, cy, w, h, cloud, margin, gap }) {
  const { dx, dy } = ray;
  const hw = it.w / 2;
  const hh = it.h / 2;
  const tMax = Math.min(
    Math.abs(dx) > 1e-9 ? (w / 2 - margin - hw) / Math.abs(dx) : Infinity,
    Math.abs(dy) > 1e-9 ? (h / 2 - margin - hh) / Math.abs(dy) : Infinity,
  );
  let lo = 0;
  let hi = Math.max(tMax, 1);
  const at = (t) => ({ x: cx + dx * t, y: cy + dy * t, w: it.w, h: it.h });
  if (hitsCloud(at(hi), cx, cy, cloud, gap)) lo = hi;
  else {
    for (let k = 0; k < 24; k++) {
      const mid = (lo + hi) / 2;
      if (hitsCloud(at(mid), cx, cy, cloud, gap)) lo = mid; else hi = mid;
    }
  }
  return { tMin: hi, tMax };
}

const FILL_MAX = 0.5;

/** Hur stor del av scenens fria yta (utanför molnet) bubblorna tar, med luft. */
export function fillRatio({ w, h, cloud, bubbles, margin = 22, gap = 16 }) {
  const used = bubbles.reduce((s, b) => s + (b.w + gap) * (b.h + gap), 0);
  const free = (w - 2 * margin) * (h - 2 * margin) - Math.PI * (cloud.rx + gap) * (cloud.ry + gap);
  return used / Math.max(1, free);
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

  // Hur långt ut den yttersta ringen går: få bubblor → närmare molnet.
  const reach = R === 1 ? Math.min(1, 0.35 + n * 0.08) : Math.min(1, 0.5 + n * 0.025);

  // Jämna vinklar i skapandeordning, medurs från toppen. Varje bubbla
  // flyttas ut längs sin egen stråle: från närmast molnet (utan att röra
  // det) till längst ut i scenen — efter SIN bredd och höjd, så att breda
  // bubblor inte hamnar i molnet och smala inte står onödigt långt ut.
  free.forEach((it, i) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    // Strålen följer scenens form (en ellips i scenens proportioner).
    let dx = Math.cos(a) * w;
    let dy = Math.sin(a) * h;
    const len = Math.hypot(dx, dy) || 1;
    dx /= len;
    dy /= len;
    const hw = it.w / 2;
    const hh = it.h / 2;
    const tMax = Math.min(
      Math.abs(dx) > 1e-9 ? (w / 2 - margin - hw) / Math.abs(dx) : Infinity,
      Math.abs(dy) > 1e-9 ? (h / 2 - margin - hh) / Math.abs(dy) : Infinity,
    );
    // Närmast molnet: halvera fram till första t där rektangeln går fri.
    let lo = 0;
    let hi = Math.max(tMax, 1);
    const at = (t) => ({ x: cx + dx * t, y: cy + dy * t, w: it.w, h: it.h });
    if (hitsCloud(at(hi), cx, cy, cloud, gap)) lo = hi;
    else {
      for (let k = 0; k < 24; k++) {
        const mid = (lo + hi) / 2;
        if (hitsCloud(at(mid), cx, cy, cloud, gap)) lo = mid; else hi = mid;
      }
    }
    const tMin = hi;
    const f = R === 1 ? reach : (ringOf[i] / (R - 1)) * reach;
    const t = tMin >= tMax ? tMax : tMin + (tMax - tMin) * f;
    it.x = cx + dx * t;
    it.y = cy + dy * t;
  });
  return items;
}

/** Steg 2: knuffa isär överlapp, ut ur molnet och in i scenen. */
function relax({ w, h, cloud, items, margin, gap, stuck = false }) {
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
        // Har paret fastnat (molnet eller kanten tar tillbaka knuffen) byts
        // axeln varannan runda efter en stund.
        let px = 0;
        let py = 0;
        let alongX = ox / (a.w + b.w) < oy / (a.h + b.h);
        if (stuck && iter > 120 && (iter + i + j) % 2) alongX = !alongX;
        if (alongX) px = Math.sign(dx || 1) * (ox + 0.5);
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
