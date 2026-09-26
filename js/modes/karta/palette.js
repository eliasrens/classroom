/**
 * TANKEKARTANS PALETT (issue #53, #59) — ljusa pastelltoner som går att
 * läsa på projektor. Huvudbubblorna får färgerna i tur och ordning (eller
 * den neutrala "krita" när läraren stängt av automatisk färgläggning);
 * färgen sparas på bubblan, så en borttagning färgar aldrig om de andra.
 *
 * Grenar (#59) ärver förälderns färg i en LJUSARE nyans — en hel gren hör
 * ihop. En gren med egen färg (color = index) visas i full ton, och dess
 * egna grenar ärver den.
 *
 * Bubbeltexten är alltid INK (#1f2328). Kontrasten mot varje botten, även
 * de ljusare grennyanserna, är över 11:1 (WCAG AA kräver 4,5:1) —
 * kontrolleras i docs/test-karta.mjs. Kanten är en mörkare nyans av
 * bubblans egen färg (dekor, ingen text).
 *
 * Molnet (#59) har en egen rad med åtta färger: sex ljusa och två djupa.
 * Rubrikens textfärg väljs automatiskt (INK eller vit) efter bästa
 * kontrast — alltid minst 4,5:1.
 */

export const INK = "#1f2328";
export const WHITE = "#ffffff";

export const PALETTE = [
  { id: "himmel", label: "Himmelsblå", bg: "#cfe2f6", edge: "#86aed8" },
  { id: "mint", label: "Mint", bg: "#cdebd8", edge: "#7fbb98" },
  { id: "rosa", label: "Rosa", bg: "#f8d2d8", edge: "#d99aa5" },
  { id: "lila", label: "Lila", bg: "#e1d6f3", edge: "#a996d2" },
  { id: "persika", label: "Persika", bg: "#fbdcc5", edge: "#dca47c" },
  { id: "havsgron", label: "Havsgrön", bg: "#c9e9e7", edge: "#7cbbb7" },
  { id: "salvia", label: "Salvia", bg: "#e3ebc8", edge: "#a6b776" },
  { id: "orkide", label: "Orkidé", bg: "#f2d4ea", edge: "#c890ba" },
  { id: "sand", label: "Sand", bg: "#efe2c9", edge: "#c3a672" },
  { id: "krita", label: "Krita (neutral)", bg: "#f1eee7", edge: "#b5ad9c" },
];

/** Färgerna som huvudbubblorna får i tur och ordning (inte den neutrala). */
export const AUTO_COLORS = 9;
/** Den neutrala färgen (automatisk färgläggning avstängd). */
export const NEUTRAL = 9;

/** Molnets färger. Index 0 är standard (som i #53). */
export const CLOUD_COLORS = [
  { id: "sol", label: "Sol", fill: "#f8e5b5", edge: "#d9b566" },
  { id: "himmel", label: "Himmelsblå", fill: "#cfe2f6", edge: "#86aed8" },
  { id: "mint", label: "Mint", fill: "#cdebd8", edge: "#7fbb98" },
  { id: "rosa", label: "Rosa", fill: "#f8d2d8", edge: "#d99aa5" },
  { id: "lila", label: "Lila", fill: "#e1d6f3", edge: "#a996d2" },
  { id: "persika", label: "Persika", fill: "#fbdcc5", edge: "#dca47c" },
  { id: "hav", label: "Havsblå", fill: "#2f5f8a", edge: "#1f4466" },
  { id: "plommon", label: "Plommon", fill: "#6d4270", edge: "#4d2d50" },
];

const wrap = (i, n) => (Number.isInteger(i) ? ((i % n) + n) % n : 0);

/** Färgen för ett färgindex (sparat på bubblan). */
export function bubbleColor(i) {
  return PALETTE[wrap(i, PALETTE.length)];
}

/** Molnets färg med rubrikens textfärg (bäst kontrast av INK och vit). */
export function cloudColor(i) {
  const c = CLOUD_COLORS[wrap(i, CLOUD_COLORS.length)];
  const ink = contrast(INK, c.fill) >= contrast(WHITE, c.fill) ? INK : WHITE;
  return { ...c, ink, soft: ink === INK ? "#8a7b5c" : "#dfe6ee" };
}

/** Blanda #rrggbb mot vitt (t = 0 → samma, 1 → vitt). */
export function tint(hex, t) {
  const ch = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `#${ch.map((c) => Math.round(c + (255 - c) * t).toString(16).padStart(2, "0")).join("")}`;
}

/** Hur mycket ljusare en ärvd nyans blir, per led från färgens källa. */
const TINT_BG = [0, 0.42, 0.62];
const TINT_EDGE = [0, 0.18, 0.3];

/**
 * Varje bubblas färg: egen färg, annars förälderns i en ljusare nyans.
 * bubbles = [{ id, color, parentId }] → Map(id → { bg, edge, index, inherited })
 */
export function resolveColors(bubbles) {
  const byId = new Map(bubbles.map((b) => [b.id, b]));
  const out = new Map();
  const resolve = (b, guard = 0) => {
    if (out.has(b.id)) return out.get(b.id);
    let res;
    if (Number.isInteger(b.color) || !b.parentId || !byId.has(b.parentId) || guard > 8) {
      const c = bubbleColor(b.color);
      res = { bg: c.bg, edge: c.edge, index: wrap(b.color, PALETTE.length), steps: 0, inherited: false };
    } else {
      const p = resolve(byId.get(b.parentId), guard + 1);
      const steps = Math.min(TINT_BG.length - 1, p.steps + 1);
      const base = bubbleColor(p.index);
      res = { bg: tint(base.bg, TINT_BG[steps]), edge: tint(base.edge, TINT_EDGE[steps]), index: p.index, steps, inherited: true };
    }
    out.set(b.id, res);
    return res;
  };
  for (const b of bubbles) resolve(b);
  return out;
}

/** WCAG-kontrast mellan två #rrggbb. */
export function contrast(a, b) {
  const lum = (hex) => {
    const [r, g, bb] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * bb;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
