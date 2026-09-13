/**
 * Färg-hjälpare för ämnespaletten.
 *
 * Kärnan är automatisk luminansuträkning (WCAG relativ luminans):
 * givet en bakgrundsfärg får man en textfärg (mörk/ljus) som alltid
 * är läsbar. Läge 2 (lektionsplanering) återanvänder detta för
 * ämnesblocken på schemat.
 */

/** "#rgb"/"#rrggbb" → {r,g,b} 0–255. Ogiltig input → svart. */
export function hexToRgb(hex) {
  let h = String(hex).trim().replace(/^#/, "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = Number.parseInt(h, 16);
  if (h.length !== 6 || Number.isNaN(n)) return { r: 0, g: 0, b: 0 };
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

/** WCAG 2.x relativ luminans, 0 (svart) – 1 (vitt). */
export function relativeLuminance(hex) {
  const { r, g, b } = hexToRgb(hex);
  const lin = (v) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** Kontrastkvot mellan två färger enligt WCAG (1–21). */
export function contrastRatio(hexA, hexB) {
  const [hi, lo] = [relativeLuminance(hexA), relativeLuminance(hexB)].sort((a, b) => b - a);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Läsbar textfärg för en given bakgrund: väljer den av mörk/ljus
 * som ger högst kontrast. Standardfärgerna matchar designsystemets
 * --color-ink respektive vitt.
 */
export function readableTextColor(bgHex, { dark = "#1f2430", light = "#ffffff" } = {}) {
  return contrastRatio(bgHex, dark) >= contrastRatio(bgHex, light) ? dark : light;
}

/**
 * Ämnespalett. Samma värden som CSS-tokens (--subject-*) — hålls i
 * synk för att JS ska kunna räkna textfärg och rendera etiketter.
 */
export const SUBJECTS = [
  { id: "ma",   name: "Matematik",      color: "#5577b5" },
  { id: "sv",   name: "Svenska",        color: "#b05f7d" },
  { id: "en",   name: "Engelska",       color: "#7a63a8" },
  { id: "no",   name: "NO",             color: "#4e8f72" },
  { id: "so",   name: "SO",             color: "#b88540" },
  { id: "idh",  name: "Idrott & hälsa", color: "#b3564e" },
  { id: "bl",   name: "Bild",           color: "#a86d94" },
  { id: "mu",   name: "Musik",          color: "#4f93a8" },
  { id: "sl",   name: "Slöjd",          color: "#937a45" },
  { id: "tk",   name: "Teknik",         color: "#6b7f93" },
  { id: "rast", name: "Rast/övrigt",    color: "#85905f" },
];

/** Slår upp ett ämne och ger { ...subject, textColor } klart att använda. */
export function subjectStyle(subjectId) {
  const s = SUBJECTS.find((x) => x.id === subjectId) ?? SUBJECTS.at(-1);
  return { ...s, textColor: readableTextColor(s.color) };
}
