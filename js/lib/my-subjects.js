/**
 * MINA ÄMNEN — per lärare (issue #81).
 *
 * Läraren väljer vilka ämnen hon faktiskt undervisar i, så att
 * ämnesväljare och ämnesfilter slipper visa hela paletten. Valet sparas
 * PRIVAT per lärare via datalagret (offline-först, följer läraren
 * mellan datorer — ingen elevdata):
 *
 *   teachers/{uid}/settings/subjects
 *     mine: [subjectId, …]   — lärarens egna ämnen
 *
 * Inget dokument eller tom lista = INGET VAL → alla ämnen visas, precis
 * som innan funktionen fanns (ingenting går sönder för den som aldrig
 * väljer). Ett valt ämne som inte är bland mina (t.ex. i en kopierad
 * planering) visas ändå i väljaren via `keep` — inget "försvinner".
 *
 * Statistik och Veckor, som visar andra lärares lektioner, filtreras
 * ALDRIG med den här listan — där måste alla ämnen kunna visas.
 */

import { currentUid } from "../data/plans.js";

export const MY_SUBJECTS_DOC = "subjects";

/** Path till lärarens privata ämnesinställning (dokumentet MY_SUBJECTS_DOC). */
export const mySubjectsPath = (uid = currentUid()) => `teachers/${uid}/settings`;

/**
 * Lärarens valda ämnes-id:n ur det sparade dokumentet, eller null =
 * inget val gjort (alla ämnen visas). En tom sparad lista räknas också
 * som inget val — "inga ämnen alls" är aldrig ett användbart läge.
 */
export function myIds(doc) {
  const mine = doc?.mine;
  return Array.isArray(mine) && mine.length > 0 ? mine.map(String) : null;
}

/** Är ämnet bland mina? Utan val (mine = null) är alla ämnen "mina". */
export function isMine(mine, id) {
  return !mine || mine.includes(id);
}

/**
 * Filtrera en ämneslista till mina ämnen. `keep` = id:n som alltid ska
 * med även om de inte är mina (t.ex. planeringens redan valda ämne).
 * mine = null (inget val) → hela listan, oförändrad.
 */
export function filterSubjects(subjects, mine, { keep = [] } = {}) {
  if (!mine) return subjects;
  const keepSet = new Set(keep.filter(Boolean));
  return subjects.filter((s) => mine.includes(s.id) || keepSet.has(s.id));
}

/** Nästa `mine`-lista med `id` tillagt (om det inte redan finns). */
export function withMine(mine, id) {
  const list = mine ?? [];
  return list.includes(id) ? list : [...list, id];
}

/** Spara lärarens val. `mine` = [] eller null betyder "inget val" (alla visas). */
export async function saveMine(data, mine) {
  await data.put(mySubjectsPath(), { id: MY_SUBJECTS_DOC, mine: mine ?? [] });
}
