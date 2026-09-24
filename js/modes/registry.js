/**
 * LÄGESREGISTRET — lägena i menyordning (Statistik = veckoarkivet, issue #29;
 * Veckans övergångar = elevvänlig veckosammanfattning, issue #36).
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
import statistik from "./statistik.js";
import vecka from "./vecka.js";

export const MODES = [morgon, lektion, trafikljus, elever, oversikt, statistik, vecka];

export const DEFAULT_MODE_ID = MODES[0].id;

/**
 * SPÄRR: de enda lägen som får renderas på elevskärmen. Elevlista,
 * Översikt och Statistik (noteringar, lärarpaneler) får ALDRIG nå elevvyn — routern
 * vägrar montera dem där och elevskärmen följer aldrig med dit.
 * "vecka" (Veckans övergångar) visar bara passens tider och färger — inga
 * lärarnamn, noteringar eller elevdata (se js/lib/week-recap.js).
 */
export const STUDENT_MODE_IDS = ["morgon", "lektion", "trafikljus", "vecka"];

export const isStudentMode = (id) => STUDENT_MODE_IDS.includes(id);

export function getMode(id) {
  return MODES.find((m) => m.id === id) ?? null;
}
