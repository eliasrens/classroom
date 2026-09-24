/**
 * "FLYTTA ELEVDATA FRÅN MOLNET" — engångsrensning av Firestore (issue #32).
 *
 * En uttrycklig lärarhandling (knapp i Översikten, med bekräftelse).
 * För VARJE klass i molnet:
 *
 *  a. Räkna om alla befintliga notes till anonyma noteStats-streck
 *     (bevarar createdBy, createdByName, lesson och createdAt) så att
 *     klassens historik finns kvar på klassnivå. Deterministiska id:n
 *     ("note-{gammalt noteId}") gör steget idempotent och tåligt mot
 *     att två lärare kör samtidigt — inga dubbletter kan uppstå.
 *  b. Radera students, notes och praiseArchive ur molnet, och strippa
 *     praise/weekOf ur settings/morningScreen.
 *
 * Varje lärardator behåller sin egen kopia: migreringen vid uppstart
 * (js/data/migrate-local.js) har redan kopierat den lokala cachen till
 * den endast lokala lagringen INNAN lyssnarna kopplas, så rensningen
 * här tar aldrig något som inte redan är räddat lokalt på de datorer
 * som använt appen.
 *
 * Modulen pratar med Firestore-SDK:n direkt (delar app-instans med
 * auth/datalagret) — datalagret bevakar ju inte längre elevsamlingarna
 * och får aldrig göra det. Kastar vid fel; anroparen visar resultatet.
 */

import { firebaseConfig, isFirebaseConfigured } from "../firebase-config.js";
import { serverNow } from "../lib/clock.js";
import { noteStatFor } from "../modes/elever/shared.js";

const SDK_BASE = "https://www.gstatic.com/firebasejs/10.12.2";
const BATCH_LIMIT = 400; // Firestore-gräns 500 — marginal

/** classIds (valfri): begränsa till vissa klasser — används av tester
 *  (verifiera i en testklass INNAN riktiga klasser rensas). */
export async function moveStudentDataFromCloud({ onProgress = () => {}, classIds = null } = {}) {
  if (!isFirebaseConfigured()) throw new Error("Firebase är inte konfigurerat");
  const [appMod, fs] = await Promise.all([
    import(`${SDK_BASE}/firebase-app.js`),
    import(`${SDK_BASE}/firebase-firestore.js`),
  ]);
  const app = appMod.getApps().length ? appMod.getApp() : appMod.initializeApp(firebaseConfig);
  const db = fs.getFirestore(app);

  // Batcher med tak — commit i omgångar.
  let batch = fs.writeBatch(db);
  let pending = 0;
  const commitIfFull = async (force = false) => {
    if (pending === 0 || (!force && pending < BATCH_LIMIT)) return;
    await batch.commit();
    batch = fs.writeBatch(db);
    pending = 0;
  };
  const add = async (fn) => { fn(batch); pending++; await commitIfFull(); };

  // När firestore.rules väl nekar elevsamlingarna (efter rensningen)
  // svarar läsningen permission-denied — då finns inget kvar att flytta.
  // Knappen ska då säga "klart", inte fel.
  const docsOf = async (...path) => {
    try {
      return (await fs.getDocs(fs.collection(db, ...path))).docs;
    } catch (err) {
      if (err?.code === "permission-denied") return [];
      throw err;
    }
  };

  const classesSnap = await fs.getDocs(fs.collection(db, "classes"));
  const report = [];

  for (const cls of classesSnap.docs) {
    const cid = cls.id;
    if (classIds && !classIds.includes(cid)) continue;
    const name = cls.data()?.name ?? cid;
    onProgress(`Rensar ${name}…`);
    const now = serverNow();

    // a) notes → anonyma noteStats-streck (idempotent via note-{id}).
    const notes = await docsOf("classes", cid, "notes");
    for (const d of notes) {
      const note = d.data();
      const stat = {
        ...noteStatFor(d.id, note),
        createdAt: note.createdAt ?? note.updatedAt ?? now,
        updatedAt: note.updatedAt ?? note.createdAt ?? now,
      };
      await add((b) => b.set(fs.doc(db, "classes", cid, "noteStats", stat.id), stat));
    }

    // b) radera elevdata ur molnet.
    let deleted = 0;
    for (const coll of ["notes", "students", "praiseArchive"]) {
      const docs = coll === "notes" ? notes : await docsOf("classes", cid, coll);
      for (const d of docs) {
        await add((b) => b.delete(d.ref));
        deleted++;
      }
    }

    // praise/weekOf ur settings/morningScreen (behåll allt annat).
    const morningRef = fs.doc(db, "classes", cid, "settings", "morningScreen");
    const morningSnap = await fs.getDoc(morningRef);
    const morning = morningSnap.exists() ? morningSnap.data() : null;
    if (morning?.value && ("praise" in morning.value || "weekOf" in morning.value)) {
      const { praise, weekOf, ...value } = morning.value;
      await add((b) => b.set(morningRef, { ...morning, value, updatedAt: now }));
    }

    report.push({ cid, name, notes: notes.length, deleted });
  }

  await commitIfFull(true);
  return report;
}
