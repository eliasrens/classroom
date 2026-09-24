/**
 * DATALAGER — OFFLINE-FIRST.
 *
 * Abstraktion ovanpå Firestore som alla lägen använder. Principen:
 *
 *   1. ALLA läsningar och skrivningar går mot lokal lagring
 *      (localStorage, se local.js). Appen är alltid snabb och
 *      fungerar fullt ut utan nät och utan Firebase.
 *   2. Skrivningar läggs samtidigt i en OUTBOX-kö.
 *   3. Om firebase-config.js är ifylld synkas kön mot Firestore när
 *      det finns anslutning, och fjärrändringar mergas in lokalt
 *      (last-write-wins per dokument via fältet `updatedAt`, satt med
 *      servertid och skyddat mot framtida tidsstämplar — js/lib/clock.js).
 *      onSnapshot-lyssnare gör att en lärares ändringar syns hos ALLA
 *      andra inloggade lärare/flikar i realtid. En server-snapshot är
 *      auktoritativ: dokument som en annan lärare raderat tas bort även
 *      lokalt (utom egna, ännu ej pushade skrivningar i outboxen).
 *
 * Pathsyntax = Firestores: "classes", "classes/{id}/students", …
 * (se DATAMODELL.md). Alla dokument får id, `updatedAt` (epoch ms)
 * och `createdAt` automatiskt.
 *
 * API (allt asynkront, allt felsäkert):
 *   data.list(path)            → [doc]           alla dokument i samlingen
 *   data.get(path, id)         → doc | null
 *   data.put(path, doc)        → id              nytt eller helt ersatt (doc.id valfritt)
 *   data.patch(path, id, part) → void            delvis uppdatering
 *   data.remove(path, id)      → void
 *   data.watch(path, cb)       → unsubscribe     cb([doc]) direkt + vid varje ändring
 *                                                (lokal, annan flik/fönster, eller moln)
 *   data.once(path, id, plan)  → boolean         villkorad skrivning EXAKT EN GÅNG över
 *                                                alla enheter (Firestore-transaktion)
 *   data.syncState             → 'local' | 'online' | 'offline'
 *
 * 'local'  = Firebase ej konfigurerat (medvetet lokalt läge)
 * 'online' = synkar mot Firestore
 * 'offline'= Firebase konfigurerat men ingen kontakt — kön väntar
 */

import { firebaseConfig, isFirebaseConfigured } from "../firebase-config.js";
import { readCollection as readSynced, writeCollection as writeSynced, pathFromStorageKey, collectionPathsUnder } from "./local.js";
import {
  isLocalOnlyPath, readLocalCollection, writeLocalCollection,
  localPathFromStorageKey, localCollectionPathsUnder,
} from "./local-only.js";
import { migrateStudentDataToLocal } from "./migrate-local.js";
import { createFirestoreSync } from "./firestore-sync.js";
import { serverNow, remoteWins } from "../lib/clock.js";

// ---- ENDAST LOKALT (issue #32) ----
// Elevdata (students, notes, praise, praiseArchive, privacy under en
// klass) lagras BARA lokalt (js/data/local-only.js) och går ALDRIG via
// outboxen eller Firestore. Datalagret routar per path: samma API för
// lägena, men skrivningar till lokala paths köas inte och molnadaptern
// ser dem aldrig.
const readCollection = (path) =>
  isLocalOnlyPath(path) ? readLocalCollection(path) : readSynced(path);
const writeCollection = (path, docs) =>
  isLocalOnlyPath(path) ? writeLocalCollection(path, docs) : writeSynced(path, docs);

const OUTBOX_PREFIX = "classroom:outbox:";      // en nyckel per op
const OUTBOX_KEY = "classroom:outbox";          // gammal array-kö (före #30), töms bara
const OUTBOX_LOCK = "classroom-outbox";          // Web Locks-namn
const LEASE_KEY = "classroom:outbox-lease";      // reserv utan Web Locks
const LEASE_TTL_MS = 15000;
const LEASE_RETRY_MS = 2000;
const RETRY_BASE_MS = 300;
const RETRY_MAX_MS = 30000;

// createSync: bara för tester (docs/test-outbox.mjs) — byt molnadaptern mot en attrapp.
export function createDataLayer({ onSyncState, createSync = createFirestoreSync } = {}) {
  // Elevdata → lokal lagring, INNAN någon Firestore-lyssnare kopplas
  // (annars kunde en auktoritativ snapshot tömma cachen som migreringen
  // ska kopiera ifrån). Se js/data/migrate-local.js.
  try { migrateStudentDataToLocal(); } catch (err) {
    console.warn("[data] migrering till lokal elevdata misslyckades:", err);
  }

  const watchers = new Map(); // path → Set<cb>
  let syncState = "local";
  let sync = null;

  const newId = () =>
    (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`);

  function setSyncState(next) {
    if (next === syncState) return;
    const wasOffline = syncState === "offline";
    syncState = next;
    onSyncState?.(next);
    // Tillbaka online (t.ex. första server-snapshoten efter ett avbrott):
    // töm outboxen direkt — vänta inte på nästa skrivning eller online-event.
    if (next === "online" && wasOffline) void flush();
  }

  function notify(path) {
    const docs = Object.values(readCollection(path));
    for (const cb of watchers.get(path) ?? []) {
      try { cb(docs); } catch (err) { console.warn(`[data] watcher för "${path}":`, err); }
    }
  }

  // ---- Outbox ----
  //
  // Semantik (se även DATAMODELL.md → Outbox):
  //  - Varje op lagras under en EGEN localStorage-nyckel
  //    (`classroom:outbox:<tid>:<löpnr>:<opId>`) — enqueue är ett setItem
  //    och borttagning ett removeItem. Aldrig läs-ändra-skriv på en delad
  //    array: localStorage är inte atomärt mellan flikar i olika processer,
  //    så två fönster som skrev om samma array kunde skriva över varandras
  //    nyss köade ops (tyst dataförlust).
  //  - En op tas bort ur kön PER IDENTITET efter lyckad push — aldrig
  //    positionellt (slice(1) kunde radera en annan, opushad op).
  //  - Bara EN flush kör åt gången per fönster (promise-spärr som sätts
  //    synkront), och mellan fönster (lärare ↔ elevskärm delar samma
  //    outbox) via Web Locks, med ett localStorage-lease som reserv. Ett
  //    flush-anrop under pågående flush tappas inte: kön körs igen efteråt.
  //  - Pushar två fönster ändå samma op är det ofarligt: pushen är en
  //    LWW-transaktion (firestore-sync.js) och därmed idempotent.
  //  - Transaktionskonflikt (failed-precondition/aborted) = försök igen
  //    strax; op:en ligger kvar och synkstatusen påverkas inte.

  let opSeq = 0;

  /** Köade ops i ordning: [{ key, op }]. Äldre outboxar (en array under
   *  OUTBOX_KEY, före #30) töms först; nya ops ligger under egna nycklar. */
  function readOutboxEntries() {
    let legacy = [];
    try {
      const ops = JSON.parse(localStorage.getItem(OUTBOX_KEY));
      if (Array.isArray(ops)) legacy = ops.map((op) => ({ key: null, op }));
    } catch { /* trasig gammal kö — ignorera */ }
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(OUTBOX_PREFIX)) keys.push(k);
    }
    keys.sort();
    const entries = [];
    for (const key of keys) {
      try {
        const op = JSON.parse(localStorage.getItem(key));
        if (op) entries.push({ key, op });
      } catch { localStorage.removeItem(key); } // trasig op — kan aldrig pushas
    }
    return [...legacy, ...entries];
  }
  const readOutbox = () => readOutboxEntries().map((e) => e.op);

  /** Identitet för en op i den gamla array-kön (ops utan opId jämförs på
   *  innehåll — två sådana med samma nyckel är samma skrivning). */
  const opKey = (o) => o.opId
    ?? `${o.op}|${o.path}|${o.id}|${o.op === "delete" ? o.at : o.doc?.updatedAt}`;

  function removeFromOutbox({ key, op }) {
    if (key) { localStorage.removeItem(key); return; }
    const id = opKey(op);
    let legacy = [];
    try { legacy = JSON.parse(localStorage.getItem(OUTBOX_KEY)) ?? []; } catch { /* tom */ }
    const rest = Array.isArray(legacy) ? legacy.filter((o) => opKey(o) !== id) : [];
    if (rest.length) localStorage.setItem(OUTBOX_KEY, JSON.stringify(rest));
    else localStorage.removeItem(OUTBOX_KEY);
  }

  function enqueue(op) {
    if (isLocalOnlyPath(op.path)) return; // elevdata — lämnar ALDRIG datorn
    if (!isFirebaseConfigured()) return; // rent lokalt läge — ingen kö behövs
    const opId = newId();
    const key = `${OUTBOX_PREFIX}${String(Date.now()).padStart(15, "0")}:${String(opSeq++).padStart(8, "0")}:${opId}`;
    try {
      localStorage.setItem(key, JSON.stringify({ ...op, opId }));
    } catch (err) {
      console.warn("[data] kunde inte köa ändringen för synk (full lagring?):", err);
    }
    void flush();
  }

  let flushing = null;     // pågående flush (Promise) — spärren, sätts synkront
  let flushAgain = false;  // flush begärd medan en redan körde → kör igen efteråt
  let retryTimer = null;
  let conflictStreak = 0;

  const isConflict = (err) => err?.code === "failed-precondition" || err?.code === "aborted";

  function scheduleRetry(ms) {
    if (retryTimer) return;
    retryTimer = setTimeout(() => { retryTimer = null; void flush(); }, ms);
  }

  /** Försök tömma outboxen mot Firestore. Ofarlig att anropa när som helst,
   *  hur ofta som helst och från flera håll samtidigt. */
  function flush() {
    if (!sync) return Promise.resolve();
    if (flushing) { flushAgain = true; return flushing; }
    flushing = (async () => {
      try {
        do {
          flushAgain = false;
          if (!(await sync.start())) return;
          const result = await withOutboxLock(drainOutbox);
          if (result === "lease-busy") { scheduleRetry(LEASE_RETRY_MS); return; }
          if (result !== "done") return; // fel → retry schemalagd / väntar på online
        } while (flushAgain);
      } catch (err) {
        console.warn("[data] flush avbröts oväntat — ops ligger kvar i kön:", err);
      } finally {
        flushing = null;
      }
    })();
    return flushing;
  }

  /** Töm kön — körs under outbox-låset. Läser om outboxen före varje op så
   *  att ops som köas under tiden (här eller i ett annat fönster) kommer med. */
  async function drainOutbox(renewLease) {
    try {
      for (let e = readOutboxEntries()[0]; e; e = readOutboxEntries()[0]) {
        await sync.push(e.op); // kastar vid fel → op ligger kvar
        removeFromOutbox(e);
        renewLease?.();
      }
      conflictStreak = 0;
      setSyncState("online");
      return "done";
    } catch (err) {
      if (isConflict(err)) {
        // Samtidig skrivning till samma dokument (annan lärare/flik) —
        // inget fel, bara försök igen strax. LWW i pushen avgör vem som vinner.
        const ms = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** conflictStreak++);
        console.info(`[data] transaktionskonflikt (${err.code}) — försöker igen om ${ms} ms`);
        scheduleRetry(ms);
        return "conflict";
      }
      console.warn("[data] synk pausad, försöker igen senare:", err);
      setSyncState("offline");
      return "error";
    }
  }

  // ---- Outbox-lås mellan fönster ----

  const lockOwner = newId();

  /** Kör fn med exklusivt outbox-lås över alla fönster i samma origin.
   *  Web Locks där det finns (väntar in det andra fönstrets flush);
   *  annars ett localStorage-lease med utgångstid (ett fönster som
   *  stängs mitt i en flush låser därmed inte kön för gott). */
  async function withOutboxLock(fn) {
    if (navigator.locks?.request) {
      try {
        return await navigator.locks.request(OUTBOX_LOCK, () => fn());
      } catch (err) {
        // Kan kasta i vissa sandlådor (t.ex. opak origin) — falla tillbaka.
        if (err?.name !== "SecurityError" && err?.name !== "InvalidStateError") throw err;
      }
    }
    if (!acquireLease()) return "lease-busy";
    try { return await fn(acquireLease); } finally { releaseLease(); }
  }

  function readLease() {
    try { return JSON.parse(localStorage.getItem(LEASE_KEY)); } catch { return null; }
  }
  function acquireLease() {
    const lease = readLease();
    if (lease && lease.owner !== lockOwner && lease.until > Date.now()) return false;
    try {
      localStorage.setItem(LEASE_KEY, JSON.stringify({ owner: lockOwner, until: Date.now() + LEASE_TTL_MS }));
    } catch { /* full lagring — kör ändå, pushen är idempotent */ }
    return true;
  }
  function releaseLease() {
    try { if (readLease()?.owner === lockOwner) localStorage.removeItem(LEASE_KEY); } catch { /* ignorera */ }
  }

  // ---- Merge av fjärrdata (last-write-wins per dokument) ----

  /** Dokument-id:n i samlingen `path` som ligger osparade i outboxen
   *  (lokalt skapade/ändrade, ännu ej pushade). En delete-op räknas inte:
   *  då är dokumentet redan borttaget lokalt. */
  function pendingIdsFor(path) {
    const ids = new Set();
    for (const op of readOutbox()) {
      if (op.path === path && op.op !== "delete") ids.add(op.id);
    }
    return ids;
  }

  function mergeRemote(path, remoteDocs, { authoritative = false } = {}) {
    if (isLocalOnlyPath(path)) return; // fjärrdata får aldrig röra lokal elevdata
    const local = readCollection(path);
    const merged = { ...local };
    let changed = false;
    let pending = null; // läses bara om någon tidsstämpel ligger i framtiden
    const now = serverNow();

    // Ta in/uppdatera fjärrdokument — last-write-wins per dokument via
    // updatedAt. En framtida tidsstämpel (fel klocka på någon enhet) vinner
    // aldrig mot en riktig: då gäller servern, utom mot en egen opushad
    // ändring (se remoteWins i js/lib/clock.js).
    for (const [id, doc] of Object.entries(remoteDocs)) {
      const isPending = () => (pending ??= pendingIdsFor(path)).has(id);
      if (remoteWins(local[id], doc, { now, pending: isPending })) {
        const remote = { ...doc, id };
        if (JSON.stringify(local[id]) !== JSON.stringify(remote)) {
          merged[id] = remote;
          changed = true;
        }
      }
    }

    // Fjärr-borttagningar: när en annan lärare raderar en elev/notering/
    // planering ska den försvinna även här (realtidsdelning). Verkställs
    // BARA på en auktoritativ server-snapshot — och aldrig på dokument som
    // ligger osparade i outboxen (skapade lokalt offline, finns ännu inte
    // i molnet men får inte tolkas som "raderade").
    if (authoritative) {
      const pending = pendingIdsFor(path);
      for (const id of Object.keys(local)) {
        if (!(id in remoteDocs) && !pending.has(id)) {
          delete merged[id];
          changed = true;
        }
      }
    }

    if (changed) {
      writeCollection(path, merged);
      notify(path);
    }
  }

  // ---- Publikt API ----

  const api = {
    get syncState() { return syncState; },

    async list(path) {
      return Object.values(readCollection(path));
    },

    async get(path, id) {
      return readCollection(path)[id] ?? null;
    },

    async put(path, doc) {
      const id = doc.id ?? newId();
      const now = serverNow();
      const existing = readCollection(path)[id];
      const full = { createdAt: existing?.createdAt ?? now, ...doc, id, updatedAt: now };
      writeCollection(path, { ...readCollection(path), [id]: full });
      notify(path);
      enqueue({ op: "set", path, id, doc: full });
      return id;
    },

    async patch(path, id, partial) {
      const docs = readCollection(path);
      if (!docs[id]) return;
      const full = { ...docs[id], ...partial, id, updatedAt: serverNow() };
      writeCollection(path, { ...docs, [id]: full });
      notify(path);
      enqueue({ op: "patch", path, id, doc: full });
    },

    async remove(path, id) {
      const docs = readCollection(path);
      if (!docs[id]) return;
      const { [id]: _gone, ...rest } = docs;
      writeCollection(path, rest);
      notify(path);
      enqueue({ op: "delete", path, id, at: serverNow() }); // at: LWW mot servern
    },

    /** Alla lagrade samlings-paths under ett prefix (t.ex. "classes/4a/") —
     *  både synkade och endast lokala samlingar. */
    async collections(prefix) {
      return [...new Set([...collectionPathsUnder(prefix), ...localCollectionPathsUnder(prefix)])];
    },

    /**
     * Villkorad skrivning som ska ske EXAKT EN GÅNG — även om flera lärare
     * öppnar appen samtidigt (t.ex. veckans tömning av Bra jobbat, se
     * js/lib/week-rhythm.js). plan(doc|null) får aktuell version av
     * (path,id) och returnerar null (inget att göra) eller [{ path, doc }].
     * Med Firebase körs det som en transaktion mot SERVERNS version, så
     * bara den första enheten skriver; resultatet mergas in lokalt direkt.
     * Utan Firebase: mot den lokala lagringen. Firebase konfigurerat men
     * inte nåbart → görs INTE (false; försök igen senare) — om inte
     * allowLocal, då görs det lokalt och köas som vanliga skrivningar.
     * Returnerar true om något skrevs.
     */
    async once(path, id, plan, { allowLocal = false } = {}) {
      const stamp = (writes) => {
        const now = serverNow();
        return writes.map(({ path: p, doc }) => ({
          path: p,
          doc: { createdAt: doc.createdAt ?? now, ...doc, updatedAt: now },
        }));
      };
      const runLocal = async () => {
        const writes = plan(readCollection(path)[id] ?? null);
        if (!writes?.length) return false;
        for (const w of writes) await api.put(w.path, w.doc);
        return true;
      };

      if (isLocalOnlyPath(path) || !isFirebaseConfigured()) return runLocal();
      if (sync && (await sync.start())) {
        try {
          const written = await sync.transact(path, id, (doc) => {
            const writes = plan(doc);
            return writes?.length ? stamp(writes) : null;
          });
          for (const w of written) mergeRemote(w.path, { [w.doc.id]: w.doc });
          return written.length > 0;
        } catch (err) {
          console.warn(`[data] once(${path}/${id}) nådde inte servern:`, err);
        }
      }
      return allowLocal ? runLocal() : false;
    },

    watch(path, cb) {
      if (!watchers.has(path)) watchers.set(path, new Set());
      watchers.get(path).add(cb);
      if (!isLocalOnlyPath(path)) sync?.watch(path);
      cb(Object.values(readCollection(path)));
      return () => watchers.get(path)?.delete(cb);
    },
  };

  // ---- Uppstart ----

  if (isFirebaseConfigured()) {
    setSyncState("offline"); // konfigurerat men ännu ej uppkopplat
    sync = createSync({
      firebaseConfig,
      onRemoteDocs: mergeRemote,
      onStatus: setSyncState,
    });
    void flush();
    // Nät tillbaka: ge SDK-laddningen en ny chans (den kan ha misslyckats
    // vid kallstart offline) och töm sedan kön.
    window.addEventListener("online", () => { sync.reset(); void flush(); });
  }

  // Live-uppdatering mellan flikar/fönster (lärarfönster ↔ elevskärm) —
  // gäller både synkade samlingar och den endast lokala elevdatan.
  window.addEventListener("storage", (e) => {
    const path = pathFromStorageKey(e.key) ?? localPathFromStorageKey(e.key);
    if (path && watchers.has(path)) notify(path);
  });

  return api;
}
