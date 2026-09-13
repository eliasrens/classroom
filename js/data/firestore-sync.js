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
        (snap) => {
          const docs = {};
          snap.forEach((d) => { docs[d.id] = d.data(); });
          onRemoteDocs?.(path, docs);
          onStatus?.(snap.metadata.fromCache ? "offline" : "online");
        },
        (err) => {
          console.warn(`[data/sync] lyssnare för "${path}" föll:`, err);
          onStatus?.("offline");
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

  /** Skriv en outbox-operation. Kastar vid fel (datalagret behåller op:en i kön). */
  async function push(op) {
    if (!fs) throw new Error("Firestore ej uppkopplat");
    const { db, api } = fs;
    const ref = api.doc(db, ...op.path.split("/"), op.id);
    if (op.op === "delete") await api.deleteDoc(ref);
    else await api.setDoc(ref, op.doc, { merge: op.op === "patch" });
  }

  return { start, watch, push, get connected() { return fs != null; } };
}
