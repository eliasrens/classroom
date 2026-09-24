/**
 * ENDAST LOKAL LAGRING — elevdata som ALDRIG lämnar datorn (issue #32).
 *
 * GDPR-principen: ingenting om enskilda elever får lämna lärardatorn.
 * Till molnet går bara klasstatistik (trafikljuspass + anonyma
 * noteringsräkningar, se DATAMODELL.md → noteStats).
 *
 * Den här modulen är den tydligt avgränsade lokala lagringen: samma
 * dokumentmodell som js/data/local.js ({ id → doc } per samling) men
 * under ett EGET prefix, `classroom:local:`, och HELT frikopplad från
 * synken — ingenting härifrån går någonsin via datalagrets outbox,
 * firestore-sync eller Firestore. Datalagret (js/data/datalayer.js)
 * routar alla läsningar/skrivningar för paths i LOCAL_ONLY hit och
 * hoppar över kön; molnadaptern ser aldrig dessa paths.
 *
 * Elevskärmen (samma webbläsare, annat fönster) läser samma lagring —
 * livespegling fungerar via storage-eventet precis som för resten.
 *
 * LOKALA samlingar per klass:
 *   classes/{cid}/students       — elevlistan (namn, tag, active, hotkey)
 *   classes/{cid}/notes          — noteringar (text, followUp, insatser, …)
 *   classes/{cid}/praise         — Bra jobbat-listan (doc "board": praise, weekOf)
 *   classes/{cid}/praiseArchive  — veckoarkivet av Bra jobbat (innehåller namn)
 *   classes/{cid}/privacy        — lokal gallringsinställning (noteRetentionWeeks)
 */

const PREFIX = "classroom:local:";

/** Samlings-suffix (sista path-segmentet under classes/{cid}/) som är lokala. */
const LOCAL_ONLY = new Set(["students", "notes", "praise", "praiseArchive", "privacy"]);

/** Är detta en samling som bara får finnas lokalt? */
export function isLocalOnlyPath(path) {
  const m = /^classes\/[^/]+\/([^/]+)$/.exec(path ?? "");
  return m != null && LOCAL_ONLY.has(m[1]);
}

export const localStorageKeyFor = (path) => PREFIX + path;

/** Alla dokument i en lokal samling: { id → doc }. */
export function readLocalCollection(path) {
  try {
    return JSON.parse(localStorage.getItem(localStorageKeyFor(path))) ?? {};
  } catch {
    return {};
  }
}

export function writeLocalCollection(path, docs) {
  try {
    localStorage.setItem(localStorageKeyFor(path), JSON.stringify(docs));
  } catch (err) {
    console.warn(`[data/local-only] kunde inte spara "${path}":`, err);
  }
}

/** Är en storage-nyckel en lokal samling? → path eller null. */
export function localPathFromStorageKey(key) {
  return key?.startsWith(PREFIX) ? key.slice(PREFIX.length) : null;
}

/** Alla lokala samlings-paths som börjar med `prefix` (jfr local.js). */
export function localCollectionPathsUnder(prefix) {
  const paths = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const path = localPathFromStorageKey(localStorage.key(i));
      if (path && path.startsWith(prefix)) paths.push(path);
    }
  } catch { /* lagring otillgänglig — inga paths */ }
  return paths;
}
