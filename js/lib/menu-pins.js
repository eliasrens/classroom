/**
 * FÄSTA LÄGEN I ÖVERMENYN — per lärare (issue #52).
 *
 * Varje lärare väljer själv vilka lägen som står i övermenyn. Resten nås
 * alltid via "Verktyg ▾", där alla rutiner och verktyg listas och varje
 * rad har en nål som fäster/lossar läget. Valet sparas PRIVAT per lärare
 * via datalagret (offline-först, följer läraren mellan datorer):
 *
 *   teachers/{uid}/settings/menu
 *     pinned: [modeId, …]   — fästa lägen (ordningen är alltid listans)
 *
 * Ingen elevdata. I lokalt läge (uid "local") gäller samma path lokalt.
 * Okända/borttagna id ignoreras, och ett NYTT verktyg är inte fäst förrän
 * läraren fäster det (listan sparas uttryckligen, aldrig som "allt utom").
 * Finns inget dokument ännu gäller DEFAULT_PINNED.
 */

import { modesInGroup } from "../modes/registry.js";

export const MENU_SETTINGS_DOC = "menu";
export const DEFAULT_PINNED = Object.freeze(["morgon", "lektion", "trafikljus"]);

/** Path till lärarens privata menyinställning (dokumentet MENU_SETTINGS_DOC). */
export const menuSettingsPath = (uid) => `teachers/${uid}/settings`;

/** Lägena som kan fästas — rutinerna och verktygen, i listans ordning. */
export const pinnableModes = () => [...modesInGroup("classroom"), ...modesInGroup("tools")];

/**
 * Fästa lägen ur det sparade dokumentet (eller null = inget sparat ännu),
 * i listans ordning. Okända id och dubbletter faller bort.
 */
export function pinnedIds(doc) {
  const saved = Array.isArray(doc?.pinned) ? doc.pinned : DEFAULT_PINNED;
  const wanted = new Set(saved);
  return pinnableModes().map((m) => m.id).filter((id) => wanted.has(id));
}

/** Nästa `pinned`-lista när läraren fäster/lossar `id`. */
export function togglePinned(pinned, id) {
  if (!pinnableModes().some((m) => m.id === id)) return pinnedIds({ pinned });
  const next = pinned.includes(id) ? pinned.filter((p) => p !== id) : [...pinned, id];
  return pinnedIds({ pinned: next });
}
