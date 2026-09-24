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
 *
 * Klockan (issue #31): "nu" är serverNow() (js/lib/clock.js), och med
 * Firebase körs veckorytmen först när klockan är mätt mot servern — en
 * dator med fel klocka ska inte rulla veckan för alla. En weekOf i
 * FRAMTIDEN (skriven med fel klocka) är ogiltig: den rättas till
 * innevarande vecka och listan behålls (som äldre data utan weekOf).
 */

import { MORNING_KEY, settingsPath, praiseIsStale, praiseWeekInFuture, normalize } from "./morning.js";
import { weekKey, weekStartFromKey, startOfWeek } from "./week.js";
import { attribution } from "../data/plans.js";
import { serverNow, clockCalibrated, onClockChange } from "./clock.js";

export const praiseArchivePath = (cid) => `classes/${cid}/praiseArchive`;

const CHECK_INTERVAL_MS = 60_000;

/**
 * Vad ska skrivas för att föra morgonskärmsdokumentet till innevarande
 * vecka? null = ingenting (redan aktuellt eller saknas). Ren funktion —
 * körs i transaktionen och kan göras om.
 */
export function planPraiseRollover(doc, cid, now = serverNow()) {
  const value = doc?.value;
  if (!value) return null;
  const current = weekKey(now);
  if (value.weekOf === current) return null;
  const weekStart = weekStartFromKey(value.weekOf);

  const writes = [];
  if (weekStart == null || weekStart > startOfWeek(now)) {
    // Äldre data utan weekOf, eller ogiltig weekOf i framtiden (fel klocka
    // på någon enhet): listan räknas till innevarande vecka och behålls.
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
  return doc?.value != null
    && (doc.value.weekOf == null || praiseIsStale(doc.value) || praiseWeekInFuture(doc.value));
}

/** Starta veckorytmen i lärarfönstret. Returnerar stop(). */
export function startWeekRhythm({ store, data, intervalMs = CHECK_INTERVAL_MS }) {
  let busy = false;
  async function check() {
    const { view, classId } = store.get();
    if (busy || view !== "teacher" || !classId) return;
    // Med Firebase: vänta tills klockan är mätt mot servern (se ovan).
    if (data.syncState !== "local" && !clockCalibrated()) return;
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
  const unsubClock = onClockChange(() => void check());
  const timer = setInterval(() => void check(), intervalMs);
  const onVisible = () => { if (document.visibilityState === "visible") void check(); };
  document.addEventListener("visibilitychange", onVisible);
  return () => {
    unsub();
    unsubClock();
    clearInterval(timer);
    document.removeEventListener("visibilitychange", onVisible);
  };
}
