/**
 * LOKAL LAGRING — localStorage-baserad dokumentlagring.
 *
 * Datalagrets sanningskälla i webbläsaren. Varje "samling" (samma
 * pathsyntax som Firestore, t.ex. "classes" eller
 * "classes/4a/students") lagras som ett JSON-objekt { id → dokument }
 * under en egen localStorage-nyckel.
 *
 * Val av localStorage framför IndexedDB: datamängderna är små
 * (klasslistor, planeringar — kilobyte, inte megabyte), API:t är
 * synkront och robust, och "storage"-eventet ger gratis live-synk
 * mellan lärarfönster och elevskärm i samma webbläsare.
 * Datalagrets API är asynkront, så lagringen kan bytas till
 * IndexedDB senare utan att något läge påverkas.
 */

const PREFIX = "classroom:data:";

export const storageKeyFor = (path) => PREFIX + path;

/** Alla dokument i en samling: { id → doc }. */
export function readCollection(path) {
  try {
    return JSON.parse(localStorage.getItem(storageKeyFor(path))) ?? {};
  } catch {
    return {};
  }
}

export function writeCollection(path, docs) {
  try {
    localStorage.setItem(storageKeyFor(path), JSON.stringify(docs));
  } catch (err) {
    // Kvotfel etc. — appen ska aldrig krascha på lagring.
    console.warn(`[data/local] kunde inte spara "${path}":`, err);
  }
}

/** Är en storage-nyckel en av våra datasamlingar? → path eller null. */
export function pathFromStorageKey(key) {
  return key?.startsWith(PREFIX) ? key.slice(PREFIX.length) : null;
}

/**
 * Alla lagrade samlings-paths vars path börjar med `prefix`
 * (t.ex. "classes/4a/" → alla subkollektioner för klassen 4a).
 * Används av "radera all data för klassen" (Läge 5) för att hitta
 * varje kollektion under en klass utan att känna till namnen i förväg.
 */
export function collectionPathsUnder(prefix) {
  const paths = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const path = pathFromStorageKey(localStorage.key(i));
      if (path && path.startsWith(prefix)) paths.push(path);
    }
  } catch { /* lagring otillgänglig — inga paths */ }
  return paths;
}
