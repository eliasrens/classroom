/**
 * VECKORYTM (issue #29) — rent varje måndag.
 *
 * Elevstatistik och trafikljustider behöver ingen åtgärd: vyerna
 * filtrerar på innevarande vecka (js/lib/week.js) och all historik
 * ligger kvar — tidigare veckor visas i arkivet under Statistik.
 *
 * Undantaget är Bra jobbat-listan (settings/morningScreen → praise): den
 * är ett TILLSTÅND, inte en logg. Första gången appen öppnas en ny vecka
 * sparas därför en ögonblicksbild av förra veckans lista i arkivet
 *   classes/{cid}/praiseArchive/{weekOf}   (t.ex. "2026-W38")
 * och listan töms, med weekOf = den nya veckan. Allt sker i EN
 * Firestore-transaktion mot serverns version (data.once): öppnar två
 * lärare samtidigt ser den andra att weekOf redan är ny och gör ingenting.
 * Tömningen sker alltså exakt en gång per vecka. Lektionsplaneringar
 * rörs ALDRIG.
 *
 * Körs bara i lärarvyn (elevskärmen skriver aldrig): när en klass
 * öppnas, vid lägesbyte och en gång i minuten (appen kan stå öppen
 * över helgen). Offline väntar tömningen tills servern nås — vyn är
 * ändå ren direkt, se currentPraise() i js/lib/morning.js.
 */

import { MORNING_KEY, settingsPath, praiseIsStale, normalize } from "./morning.js";
import { weekKey, weekStartFromKey, startOfWeek } from "./week.js";
import { attribution } from "../data/plans.js";

export const praiseArchivePath = (cid) => `classes/${cid}/praiseArchive`;

const CHECK_INTERVAL_MS = 60_000;

/**
 * Vad ska skrivas för att föra morgonskärmsdokumentet till innevarande
 * vecka? null = ingenting (redan aktuellt, saknas, eller weekOf i
 * framtiden). Ren funktion — körs i transaktionen och kan göras om.
 */
export function planPraiseRollover(doc, cid, now = Date.now()) {
  const value = doc?.value;
  if (!value) return null;
  const current = weekKey(now);
  if (value.weekOf === current) return null;
  const weekStart = weekStartFromKey(value.weekOf);
  if (weekStart != null && weekStart > startOfWeek(now)) return null;

  const writes = [];
  if (weekStart == null) {
    // Äldre data utan weekOf: listan räknas till innevarande vecka.
    writes.push({ path: settingsPath(cid), doc: { ...doc, value: { ...value, weekOf: current } } });
    return writes;
  }
  const praise = normalize(value).praise;
  if (praise.length > 0) {
    writes.push({
      path: praiseArchivePath(cid),
      doc: { id: value.weekOf, weekOf: value.weekOf, weekStart, praise, archivedAt: now, ...attribution() },
    });
  }
  writes.push({ path: settingsPath(cid), doc: { ...doc, value: { ...value, praise: [], weekOf: current } } });
  return writes;
}

/**
 * Arkivera + töm förra veckans Bra jobbat om det behövs. allowLocal:
 * gör det lokalt om servern inte nås (används bara när läraren redigerar
 * listan offline — annars hamnar nya namn i förra veckans lista).
 */
export function rolloverPraise(data, cid, { allowLocal = false } = {}) {
  return data.once(settingsPath(cid), MORNING_KEY, (doc) => planPraiseRollover(doc, cid), { allowLocal });
}

/** Behöver klassens morgonskärm föras till den här veckan (enligt lokal kopia)? */
async function needsRollover(data, cid) {
  const doc = await data.get(settingsPath(cid), MORNING_KEY);
  return doc?.value != null && (doc.value.weekOf == null || praiseIsStale(doc.value));
}

/** Starta veckorytmen i lärarfönstret. Returnerar stop(). */
export function startWeekRhythm({ store, data, intervalMs = CHECK_INTERVAL_MS }) {
  let busy = false;
  async function check() {
    const { view, classId } = store.get();
    if (busy || view !== "teacher" || !classId) return;
    busy = true;
    try {
      if (await needsRollover(data, classId)) await rolloverPraise(data, classId);
    } catch (err) {
      console.warn("[veckorytm] kunde inte föra Bra jobbat till ny vecka:", err);
    } finally {
      busy = false;
    }
  }
  const unsub = store.subscribe(["classId", "view", "modeId"], () => void check());
  const timer = setInterval(() => void check(), intervalMs);
  const onVisible = () => { if (document.visibilityState === "visible") void check(); };
  document.addEventListener("visibilitychange", onVisible);
  return () => {
    unsub();
    clearInterval(timer);
    document.removeEventListener("visibilitychange", onVisible);
  };
}
