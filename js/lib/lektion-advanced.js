/**
 * "AVANCERAT" I LEKTIONSPLANERINGENS SIDOPANEL — per lärare (issue #149).
 *
 * Sidopanelen är som standard lika enkel som från början. De större
 * delarna — Efter rasten, Bra jobbat, stegning och timer i Lektionsordning
 * och Widgets — visas bara när läraren slagit på växeln "Avancerat". Valet
 * sparas PRIVAT per lärare via datalagret (offline-först, följer läraren
 * mellan datorer — ingen elevdata):
 *
 *   teachers/{uid}/settings/lektionsvy
 *     advanced: boolean   — visa de avancerade delarna i sidopanelen
 *
 * Inget dokument (eller ett trasigt) = AV. I lokalt läge (uid "local")
 * gäller samma path lokalt. Växeln styr BARA sidopanelen: tavlan,
 * förhandsvisningen och elevskärmen ritas alltid likadant, och
 * planeringens data ändras aldrig av att växeln slås av eller på.
 */

import { ordningState } from "./lektionsordning.js";

export const ADVANCED_SETTINGS_DOC = "lektionsvy";

/** Fälten i "Fält" som bara visas med Avancerat på (övriga visas alltid). */
export const ADVANCED_FIELD_KEYS = Object.freeze(["efterRasten", "praise"]);

/** Path till lärarens privata inställning (dokumentet ADVANCED_SETTINGS_DOC). */
export const advancedSettingsPath = (uid) => `teachers/${uid}/settings`;

/** Avancerat på? Saknat eller ogiltigt dokument → false. */
export function isAdvanced(doc) {
  return doc?.advanced === true;
}

/**
 * De avancerade delar planeringen använder, som läsbara namn i
 * sidopanelens ordning — för informationsraden när växeln är av.
 * Stegningen räknas bara när den gäller nu (samma regel som tavlan:
 * ordningState, och Lektionsordning visas) — ett läge från igår räknas inte.
 */
export function advancedPartsInUse(plan, now = Date.now()) {
  const show = plan?.show ?? {};
  const parts = [];
  if (show.efterRasten === true) parts.push("Efter rasten");
  if (show.praise === true) parts.push("Bra jobbat");
  if (Array.isArray(plan?.widgets) && plan.widgets.length > 0) parts.push("widgets");
  if (show.attGora === true && ordningState(plan, now).active != null) parts.push("stegning i Lektionsordning");
  return parts;
}
