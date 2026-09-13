/**
 * IKONER — rena linje-ikoner som inline-SVG.
 *
 * Designspråket använder INGA emoji i gränssnittet (knappar, menyer,
 * rubriker). Behövs en ikon: lägg till den här och rendera med
 * icon("namn"). Strecken ärver textfärgen (currentColor), så ikonerna
 * följer temat automatiskt.
 *
 * Emoji är tillåtet ENBART som pedagogiskt innehåll riktat till
 * eleverna på elevskärmen — och sparsamt.
 */

const PATHS = {
  // Lägen
  sunrise: `<path d="M12 3v4M5.6 8.5 7 9.9M18.4 8.5 17 9.9M4 17h16M7 17a5 5 0 0 1 10 0M2 21h20"/>`,
  book: `<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5zM4 18.5V5.5M20 18v3H6.5"/>`,
  signal: `<rect x="8" y="2.5" width="8" height="19" rx="2.5"/><circle cx="12" cy="7" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="12" cy="17" r="1.4"/>`,
  users: `<circle cx="9" cy="8" r="3.2"/><path d="M3.5 20a5.5 5.5 0 0 1 11 0M15.8 5.2a3.2 3.2 0 0 1 0 5.6M17.5 15a5.5 5.5 0 0 1 3 5"/>`,
  chart: `<path d="M4 4v16h16M8 16v-5M12 16V8M16 16v-3"/>`,
  // Appskalet
  monitor: `<rect x="3" y="4" width="18" height="12.5" rx="1.5"/><path d="M9 20.5h6M12 16.5v4"/>`,
  logout: `<path d="M14 4H6.5A1.5 1.5 0 0 0 5 5.5v13A1.5 1.5 0 0 0 6.5 20H14M10 12h9.5M16.5 8.5 20 12l-3.5 3.5"/>`,
  sun: `<circle cx="12" cy="12" r="4"/><path d="M12 2.5V5M12 19v2.5M2.5 12H5M19 12h2.5M4.9 4.9 6.7 6.7M17.3 17.3l1.8 1.8M19.1 4.9l-1.8 1.8M6.7 17.3l-1.8 1.8"/>`,
  moon: `<path d="M20 13.5A8 8 0 0 1 10.5 4 8 8 0 1 0 20 13.5z"/>`,
  plus: `<path d="M12 5v14M5 12h14"/>`,
  expand: `<path d="M15 4h5v5M9 20H4v-5M20 4l-6.5 6.5M4 20l6.5-6.5"/>`,
  "chevron-down": `<path d="M6 9.5l6 6 6-6"/>`,
  "chevron-up": `<path d="M6 14.5l6-6 6 6"/>`,
  "chevron-left": `<path d="M14.5 6l-6 6 6 6"/>`,
  "chevron-right": `<path d="M9.5 6l6 6-6 6"/>`,
  star: `<path d="M12 3.2l2.6 5.5 6 .8-4.4 4.2 1.1 6-5.3-2.9-5.3 2.9 1.1-6L3.4 9.5l6-.8z"/>`,
  refresh: `<path d="M20 11a8 8 0 0 0-14-4.5L4 8m0 0V4m0 4h4M4 13a8 8 0 0 0 14 4.5L20 16m0 0v4m0-4h-4"/>`,
  image: `<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M20 16.5l-4.5-4.5L6 20.5"/>`,
  upload: `<path d="M12 15V4m0 0L8 8m4-4l4 4M4.5 15.5V18a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-2.5"/>`,
  trash: `<path d="M4 6.5h16M9.5 6.5V4.5h5v2M6.5 6.5l1 13a1.5 1.5 0 0 0 1.5 1.4h6a1.5 1.5 0 0 0 1.5-1.4l1-13"/>`,
  x: `<path d="M6 6l12 12M18 6L6 18"/>`,
  check: `<path d="M5 12.5l4.5 4.5L19 6.5"/>`,
  pencil: `<path d="M4 20h4L18.5 9.5a2 2 0 0 0 0-3l-1-1a2 2 0 0 0-3 0L4 16v4z"/>`,
};

/**
 * icon("book") → SVG-sträng, 1em hög (följer textstorleken).
 * size (px) ges bara när ikonen inte ska följa texten, t.ex. stora
 * platshållarikoner.
 */
export function icon(name, { size = null, strokeWidth = 1.8 } = {}) {
  const path = PATHS[name] ?? PATHS.chart;
  const dim = size ? `width="${size}" height="${size}"` : `width="1.2em" height="1.2em"`;
  return `<svg class="icon" viewBox="0 0 24 24" ${dim} fill="none"
    stroke="currentColor" stroke-width="${strokeWidth}"
    stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
}

export const iconNames = Object.keys(PATHS);
