/**
 * FIRESTORE-SYNK — molnadaptern bakom datalagret.
 *
 * Laddar Firestore JS SDK (modular, v10) dynamiskt från CDN — bara
 * om firebase-config.js är ifylld. Misslyckas laddningen (offline,
 * blockerad CDN, felkonfiguration) fortsätter appen lokalt; inget
 * här får kasta vidare till resten av appen.
 *
 * Ansvar:
 *  - push(op): skriv en kölagd lokal ändring till Firestore
 *  - watch(path): lyssna på en samling; fjärrändringar rapporteras
 *    via onRemoteDocs(path, docs) och mergas av datalagret
 *  - status: 'online'/'offline' via onStatus
 *  - calibrate(): mät servertiden (js/lib/clock.js, issue #31)
 */

import { serverNow, setServerOffset, clampStamp, clampDocStamps, opBeatsServer } from "../lib/clock.js";

const SDK_BASE = "https://www.gstatic.com/firebasejs/10.12.2";
const LISTENER_RETRY_MS = 5000;
const CALIBRATE_EVERY_MS = 10 * 60_000;  // datorns klocka kan ställas om under dagen
const CALIBRATE_RETRY_MS = 60_000;
const CALIBRATE_WAIT_MS = 4000;          // så länge start() väntar på första mätningen
const CALIBRATE_MAX_RTT_MS = 5000;       // längre tur-och-retur = för osäker mätning

const loadFirestoreSdk = () => Promise.all([
  import(`${SDK_BASE}/firebase-app.js`),
  import(`${SDK_BASE}/firebase-firestore.js`),
]);

/** Var mätdokumentet ligger: lärarens privata subträd (firestore.rules). */
function defaultClockDocPath() {
  let uid = null;
  try { uid = localStorage.getItem("classroom:auth:session"); } catch { /* ingen lagring */ }
  return uid && uid !== "local" ? `teachers/${uid}/meta/clock` : null;
}

// loadSdk/clockDocPath: bara för tester (docs/test-clock.mjs).
export function createFirestoreSync({
  firebaseConfig, onRemoteDocs, onStatus,
  loadSdk = loadFirestoreSdk, clockDocPath = defaultClockDocPath,
}) {
  let fs = null;         // { db, api } när uppkopplad
  let startFailed = false;
  const watched = new Map(); // path → unsubscribe
  const lastSnap = new Map(); // path → { docs, authoritative } — senaste fjärrläget

  let starting = null;   // pågående uppstart (delas av samtidiga anrop)
  let clockReady = null;  // första klockmätningen (eller dess tidsgräns)

  /** Ladda SDK:n och koppla upp. Samtidiga anrop väntar på samma uppstart
   *  — inklusive första klockmätningen, så ingen push hinner före den. */
  async function start() {
    if (fs) { await clockReady; return true; }
    if (startFailed) return false;
    starting ??= boot().finally(() => { starting = null; });
    return starting;
  }

  async function boot() {
    try {
      const [appMod, api] = await loadSdk();
      // Auth-lagret kan redan ha initierat appen — dela instansen.
      const app = appMod.getApps().length ? appMod.getApp() : appMod.initializeApp(firebaseConfig);
      const db = api.getFirestore(app);
      // Mät servertiden INNAN första pushen, så att kölagda ändringar
      // från en enhet med fel klocka skrivs med rätt tid. Väntar högst
      // några sekunder — nås inte servern gäller lokal tid + klämning.
      fs = { db, api };
      clockReady = Promise.race([calibrateLoop(), new Promise((r) => setTimeout(r, CALIBRATE_WAIT_MS))]);
      onStatus?.("online");
      // Ombeds lyssna innan SDK:n laddats klart? Starta nu.
      for (const path of [...watched.keys()]) {
        if (watched.get(path) === null) attachListener(path);
      }
      await clockReady;
      return true;
    } catch (err) {
      console.warn("[data/sync] Firestore kunde inte startas — kör lokalt:", err);
      fs = null;
      startFailed = true;
      onStatus?.("offline");
      return false;
    }
  }

  function attachListener(path) {
    const { db, api } = fs;
    try {
      const unsub = api.onSnapshot(
        api.collection(db, ...path.split("/")),
        // includeMetadataChanges: vi får en extra händelse när samma data
        // bekräftas från servern (fromCache: false). Det gör dels att
        // synkstatusen slår om till "online" tillförlitligt, dels att
        // fjärr-borttagningar bara verkställs på en auktoritativ snapshot.
        { includeMetadataChanges: true },
        (snap) => {
          const docs = {};
          snap.forEach((d) => { docs[d.id] = d.data(); });
          // En snapshot från servern (ej cache) är auktoritativ: den listar
          // ALLA dokument som finns i molnet, så det som saknas där är
          // raderat av en annan lärare och ska tas bort även hos oss.
          const authoritative = !snap.metadata.fromCache;
          lastSnap.set(path, { docs, authoritative });
          onRemoteDocs?.(path, docs, { authoritative });
          onStatus?.(snap.metadata.fromCache ? "offline" : "online");
        },
        (err) => {
          // En lyssnare som faller (t.ex. permission-denied innan auth-token
          // hunnit komma fram i ett nyöppnat elevfönster) är död för gott —
          // koppla en ny efter en stund i stället för att tappa realtiden.
          console.warn(`[data/sync] lyssnare för "${path}" föll — försöker igen:`, err);
          onStatus?.("offline");
          watched.set(path, null);
          setTimeout(() => { if (fs && watched.get(path) === null) attachListener(path); }, LISTENER_RETRY_MS);
        },
      );
      watched.set(path, unsub);
    } catch (err) {
      console.warn(`[data/sync] kunde inte lyssna på "${path}":`, err);
    }
  }

  /** Börja bevaka en samlings fjärrändringar. */
  function watch(path) {
    if (watched.has(path)) return;
    watched.set(path, null); // reserverad; kopplas när SDK:n är uppe
    if (fs) attachListener(path);
  }

  /**
   * Skriv en outbox-operation. Kastar vid fel (datalagret behåller op:en i kön).
   *
   * Last-write-wins per dokument gäller även MOT SERVERN: en op som legat i
   * kön (t.ex. medan läraren var offline) får inte skriva över en annan
   * lärares nyare version. Därför en transaktion som läser serverns
   * updatedAt först — är den nyare än op:ens tidsstämpel hoppas op:en över
   * och den nyare versionen når oss via lyssnaren (mergeRemote). Utan
   * detta blir det dessutom glapp: lyssnarna ignorerar den äldre versionen
   * hos lärare som redan har den nyare, så enheterna skulle se olika data.
   */
  async function push(op) {
    if (!fs) throw new Error("Firestore ej uppkopplat");
    const { db, api } = fs;
    const ref = api.doc(db, ...op.path.split("/"), op.id);
    await api.runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      // Klämning (issue #31): en op stämplad i framtiden (skriven med fel
      // klocka innan servertiden var känd) räknas som "nu" och skrivs med
      // korrekt tid; ett framtida updatedAt på servern kan aldrig blockera.
      const now = serverNow();
      const rawTime = op.op === "delete" ? op.at : op.doc?.updatedAt;
      const opTime = rawTime == null ? null : clampStamp(rawTime, now);
      const serverTime = snap.exists() ? (snap.data().updatedAt ?? 0) : 0;
      if (!opBeatsServer(opTime, serverTime, now)) {
        console.info(`[data/sync] hoppar över ${op.op} av ${op.path}/${op.id} — servern har nyare data`);
        return;
      }
      if (op.op === "delete") tx.delete(ref);
      else tx.set(ref, clampDocStamps(op.doc, now), { merge: op.op === "patch" });
    });
  }

  // ---- Servertid (issue #31) ----

  /**
   * Mät offseten mellan servertid och lokal tid: skriv serverTimestamp()
   * i lärarens privata mätdokument och läs tillbaka det från servern.
   * Servern stämplar någon gång mellan t0 och t1 → felet är högst halva
   * tur-och-returtiden. Returnerar true vid lyckad mätning.
   */
  async function calibrate() {
    if (!fs) return false;
    const path = clockDocPath();
    if (!path) return false;
    const { db, api } = fs;
    const ref = api.doc(db, ...path.split("/"));
    const t0 = Date.now();
    await api.setDoc(ref, { at: api.serverTimestamp(), localAt: t0 });
    const t1 = Date.now();
    // Hängde skrivningen i SDK:ns kö (offline) är mätningen värdelös.
    if (t1 - t0 > CALIBRATE_MAX_RTT_MS) return false;
    const snap = await api.getDocFromServer(ref);
    const at = snap.data()?.at?.toMillis?.();
    if (!Number.isFinite(at)) return false;
    setServerOffset(at - (t0 + t1) / 2);
    // Lokala kopior som föll bort i LWW mot en framtida tidsstämpel (t.ex.
    // innan klockan var känd) prövas om mot senaste fjärrläget.
    for (const [p, { docs, authoritative }] of lastSnap) onRemoteDocs?.(p, docs, { authoritative });
    return true;
  }

  let calibrating = null;
  let calibrateTimer = null;
  /** Mät nu och schemalägg nästa mätning. Samtidiga anrop delar mätning. */
  function calibrateLoop() {
    if (calibrating) return calibrating;
    clearTimeout(calibrateTimer);
    calibrating = calibrate()
      .catch((err) => { console.info("[data/sync] kunde inte mäta servertiden:", err?.code ?? err); return false; })
      .then((ok) => {
        calibrating = null;
        calibrateTimer = setTimeout(() => void calibrateLoop(), ok ? CALIBRATE_EVERY_MS : CALIBRATE_RETRY_MS);
        return ok;
      });
    return calibrating;
  }

  /**
   * Villkorad engångsskrivning mot SERVERN (data.once i datalagret).
   * Läser (path,id) i en transaktion och låter plan(serverDoc|null) avgöra
   * vad som ska skrivas: null = inget, annars [{ path, doc }] (doc.id krävs).
   * Två enheter som kör samtidigt serialiseras av Firestore — den som kommer
   * sist ser den första enhetens skrivning och får null. plan kan köras
   * flera gånger (transaktionen görs om vid krock) och måste vara ren.
   * Returnerar de skrivna dokumenten ([] om inget skrevs). Kastar vid fel.
   */
  async function transact(path, id, plan) {
    if (!fs) throw new Error("Firestore ej uppkopplat");
    const { db, api } = fs;
    const ref = api.doc(db, ...path.split("/"), id);
    return api.runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      const writes = plan(snap.exists() ? { ...snap.data(), id } : null) ?? [];
      for (const w of writes) tx.set(api.doc(db, ...w.path.split("/"), w.doc.id), w.doc);
      return writes;
    });
  }

  /** Nollställ "SDK:n gick inte att ladda" så nästa start() försöker igen
   *  (anropas när webbläsaren kommer online igen — kallstart offline ska
   *  inte låsa appen i lokalt läge för resten av sessionen). */
  function reset() {
    if (!fs) startFailed = false;
    else void calibrateLoop(); // tillbaka online: mät om klockan
  }

  return { start, watch, push, transact, reset, calibrate: calibrateLoop, get connected() { return fs != null; } };
}
