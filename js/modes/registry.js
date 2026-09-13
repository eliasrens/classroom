/**
 * LÄGESREGISTRET — de fem lägena i menyordning.
 *
 * Varje läge är en modul i js/modes/ som default-exporterar ett
 * objekt enligt docs/MODULKONTRAKT.md. Registret är den enda plats
 * som behöver ändras när ett läge byts från platshållare till
 * riktig implementation (ersätt modulen — registret pekar redan rätt).
 */
import morgon from "./morgon.js";
import lektion from "./lektion.js";
import trafikljus from "./trafikljus.js";
import elever from "./elever.js";
import oversikt from "./oversikt.js";

export const MODES = [morgon, lektion, trafikljus, elever, oversikt];

export const DEFAULT_MODE_ID = MODES[0].id;

export function getMode(id) {
  return MODES.find((m) => m.id === id) ?? null;
}
