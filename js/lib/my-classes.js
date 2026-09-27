/**
 * MINA KLASSER — per lärare (issue #102, spegel av Mina ämnen #81).
 *
 * Läraren väljer vilka klasser hon undervisar i, så att klassväljaren i
 * topbaren och Översiktens klasslista slipper visa alla skolans klasser.
 * Valet sparas PRIVAT per lärare via datalagret (offline-först, följer
 * läraren mellan datorer — ingen elevdata):
 *
 *   teachers/{uid}/settings/classes
 *     mine: [classId, …]   — lärarens egna klasser
 *
 * Inget dokument eller tom lista = INGET VAL → alla klasser visas, precis
 * som innan funktionen fanns (ingenting ändras för den som aldrig
 * väljer). Den aktiva klassen visas alltid via `keep`, även om den inte
 * är bland mina — appen byter aldrig klass i tysthet (#31).
 *
 * En vald klass som tagits bort ligger kvar i `mine` tills läraren
 * sparar om; okända id:n filtreras bort vid visning. Finns INGEN av de
 * valda klasserna kvar räknas det som inget val (alla visas) — hellre
 * det än en tom klassväljare.
 *
 * Statistik, Veckor och klassåtgärder filtreras ALDRIG med den här
 * listan — de visar redan bara den valda klassen.
 */

import { currentUid } from "../data/plans.js";

export const MY_CLASSES_DOC = "classes";

/** Path till lärarens privata klassinställning (dokumentet MY_CLASSES_DOC). */
export const myClassesPath = (uid = currentUid()) => `teachers/${uid}/settings`;

/**
 * Lärarens valda klass-id:n ur det sparade dokumentet, eller null =
 * inget val gjort (alla klasser visas). En tom sparad lista räknas också
 * som inget val — "inga klasser alls" är aldrig ett användbart läge.
 */
export function myClassIds(doc) {
  const mine = doc?.mine;
  return Array.isArray(mine) && mine.length > 0 ? mine.map(String) : null;
}

/** Är klassen bland mina? Utan val (mine = null) är alla klasser "mina". */
export function isMyClass(mine, id) {
  return !mine || mine.includes(id);
}

/**
 * Filtrera en klasslista till mina klasser. `keep` = id:n som alltid ska
 * med även om de inte är mina (t.ex. den aktiva klassen).
 * mine = null (inget val) → hela listan, oförändrad. Okända id:n i mine
 * (borttagna klasser) ignoreras; finns ingen av mina klasser kvar i
 * listan räknas det som inget val → hela listan.
 */
export function filterClasses(classes, mine, { keep = [] } = {}) {
  if (!mine || !classes.some((c) => mine.includes(c.id))) return classes;
  const keepSet = new Set(keep.filter(Boolean));
  return classes.filter((c) => mine.includes(c.id) || keepSet.has(c.id));
}

/** Nästa `mine`-lista med `id` tillagt (om det inte redan finns). */
export function withMyClass(mine, id) {
  const list = mine ?? [];
  return list.includes(id) ? list : [...list, id];
}

/** Spara lärarens val. `mine` = [] eller null betyder "inget val" (alla visas). */
export async function saveMyClasses(data, mine) {
  await data.put(myClassesPath(), { id: MY_CLASSES_DOC, mine: mine ?? [] });
}
