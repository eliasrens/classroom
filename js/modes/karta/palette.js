/**
 * TANKEKARTANS PALETT (issue #53) — ljusa pastelltoner som går att läsa på
 * projektor. Bubblorna får färgerna i tur och ordning; färgen sparas på
 * bubblan, så en borttagning färgar aldrig om de andra.
 *
 * Texten är alltid INK (#1f2328). Kontrasten mot varje botten är över
 * 11:1 (WCAG AA kräver 4,5:1, AAA 7:1) — kontrolleras i docs/test-karta.mjs.
 * Kanten är en mörkare nyans av bubblans egen färg (dekor, ingen text).
 */

export const INK = "#1f2328";

export const PALETTE = [
  { id: "himmel", bg: "#cfe2f6", edge: "#86aed8" },
  { id: "mint", bg: "#cdebd8", edge: "#7fbb98" },
  { id: "rosa", bg: "#f8d2d8", edge: "#d99aa5" },
  { id: "lila", bg: "#e1d6f3", edge: "#a996d2" },
  { id: "persika", bg: "#fbdcc5", edge: "#dca47c" },
  { id: "havsgron", bg: "#c9e9e7", edge: "#7cbbb7" },
  { id: "salvia", bg: "#e3ebc8", edge: "#a6b776" },
  { id: "orkide", bg: "#f2d4ea", edge: "#c890ba" },
  { id: "sand", bg: "#efe2c9", edge: "#c3a672" },
];

/** Färgen för ett färgindex (sparat på bubblan). */
export function bubbleColor(i) {
  const n = PALETTE.length;
  const k = Number.isInteger(i) ? ((i % n) + n) % n : 0;
  return PALETTE[k];
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
