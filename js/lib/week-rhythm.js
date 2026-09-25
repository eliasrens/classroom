/**
 * VECKORYTM (issue #29) — rent varje måndag.
 *
 * Elevstatistik och trafikljustider behöver ingen åtgärd: vyerna
 * filtrerar på innevarande vecka (js/lib/week.js) och all historik
 * ligger kvar — tidigare veckor visas i arkivet under Statistik.
 *
 * Undantaget är Bra jobbat-listan: den är ett TILLSTÅND, inte en logg.
 * Sedan issue #32 är listan ELEVDATA och lagras BARA lokalt på varje
 * lärardator (classes/{cid}/praise → doc "board", se js/lib/morning.js
 * och js/data/local-only.js). Första gången appen öppnas en ny vecka
 * sparas en ögonblicksbild av förra veckans lista i det LOKALA arkivet
 *   classes/{cid}/praiseArchive/{weekOf}   (t.ex. "2026-W38")
 * och listan töms, med weekOf = den nya veckan. Eftersom listan är per
 * dator behövs ingen Firestore-transaktion längre — varje dator rullar
 * sin egen lista (data.once körs lokalt för lokala paths), och två
 * fönster på samma dator konvergerar via det deterministiska
 * arkiv-id:t (= weekOf). Lektionsplaneringar rörs ALDRIG.
 *
 * Körs bara i lärarvyn (elevskärmen skriver aldrig): när en klass
 * öppnas, vid lägesbyte och en gång i minuten (appen kan stå öppen
 * över helgen).
 *
 * Klockan (issue #31): "nu" är serverNow() (js/lib/clock.js), och med
 * Firebase körs veckorytmen först när klockan är mätt mot servern — en
 * dator med fel klocka ska inte rulla veckan fel. En weekOf i
 * FRAMTIDEN (skriven med fel klocka) är ogiltig: den rättas till
 * innevarande vecka och listan behålls (som äldre data utan weekOf).
 */

import { PRAISE_DOC, praisePath, praiseIsStale, praiseWeekInFuture, normalize } from "./morning.js";
import { weekKey, weekStartFromKey, startOfWeek } from "./week.js";
import { attribution } from "../data/plans.js";
import { serverNow, clockCalibrated, onClockChange } from "./clock.js";

export const praiseArchivePath = (cid) => `classes/${cid}/praiseArchive`;

const CHECK_INTERVAL_MS = 60_000;

/**
 * Vad ska skrivas för att föra den lokala Bra jobbat-listan till
 * innevarande vecka? board = det lokala "board"-dokumentet (eller null).
 * null = ingenting (redan aktuellt eller saknas). Ren funktion.
 */
export function planPraiseRollover(board, cid, now = serverNow()) {
  if (!board) return null;
  const current = weekKey(now);
  if (board.weekOf === current) return null;
  const weekStart = weekStartFromKey(board.weekOf);

  const writes = [];
  if (weekStart == null || weekStart > startOfWeek(now)) {
    // Äldre data utan weekOf, eller ogiltig weekOf i framtiden (fel klocka):
    // listan räknas till innevarande vecka och behålls.
    writes.push({ path: praisePath(cid), doc: { ...board, weekOf: current } });
    return writes;
  }
  const praise = normalize({ praise: board.praise }).praise;
  if (praise.length > 0) {
    writes.push({
      path: praiseArchivePath(cid),
      doc: { id: board.weekOf, weekOf: board.weekOf, weekStart, praise, archivedAt: now, ...attribution() },
    });
  }
  writes.push({ path: praisePath(cid), doc: { ...board, praise: [], weekOf: current } });
  return writes;
}

/**
 * Arkivera + töm förra veckans Bra jobbat om det behövs. Helt lokalt
 * (allowLocal behålls i signaturen för anroparnas skull men saknar
 * verkan — lokala paths körs alltid lokalt av datalagret).
 */
export function rolloverPraise(data, cid, { allowLocal = true } = {}) {
  return data.once(praisePath(cid), PRAISE_DOC, (doc) => planPraiseRollover(doc, cid), { allowLocal });
}

/** Behöver klassens Bra jobbat föras till den här veckan? */
async function needsRollover(data, cid) {
  const board = await data.get(praisePath(cid), PRAISE_DOC);
  return board != null
    && (board.weekOf == null || praiseIsStale(board) || praiseWeekInFuture(board));
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
