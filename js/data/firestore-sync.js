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
 */

const SDK_BASE = "https://www.gstatic.com/firebasejs/10.12.2";
const LISTENER_RETRY_MS = 5000;

export function createFirestoreSync({ firebaseConfig, onRemoteDocs, onStatus }) {
  let fs = null;         // { db, api } när uppkopplad
  let startFailed = false;
  const watched = new Map(); // path → unsubscribe

  async function start() {
    if (fs || startFailed) return fs != null;
    try {
      const [appMod, api] = await Promise.all([
        import(`${SDK_BASE}/firebase-app.js`),
        import(`${SDK_BASE}/firebase-firestore.js`),
      ]);
      // Auth-lagret kan redan ha initierat appen — dela instansen.
      const app = appMod.getApps().length ? appMod.getApp() : appMod.initializeApp(firebaseConfig);
      const db = api.getFirestore(app);
      fs = { db, api };
      onStatus?.("online");
      // Ombeds lyssna innan SDK:n laddats klart? Starta nu.
      for (const path of [...watched.keys()]) {
        if (watched.get(path) === null) attachListener(path);
      }
      return true;
    } catch (err) {
      console.warn("[data/sync] Firestore kunde inte startas — kör lokalt:", err);
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
          onRemoteDocs?.(path, docs, { authoritative: !snap.metadata.fromCache });
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
    const opTime = op.op === "delete" ? op.at : op.doc?.updatedAt;
    await api.runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      const serverTime = snap.exists() ? (snap.data().updatedAt ?? 0) : 0;
      if (opTime != null && serverTime > opTime) {
        console.info(`[data/sync] hoppar över ${op.op} av ${op.path}/${op.id} — servern har nyare data`);
        return;
      }
      if (op.op === "delete") tx.delete(ref);
      else tx.set(ref, op.doc, { merge: op.op === "patch" });
    });
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
  }

  return { start, watch, push, transact, reset, get connected() { return fs != null; } };
}
