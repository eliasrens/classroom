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
 *      (last-write-wins per dokument via fältet `updatedAt`).
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
 *   data.syncState             → 'local' | 'online' | 'offline'
 *
 * 'local'  = Firebase ej konfigurerat (medvetet lokalt läge)
 * 'online' = synkar mot Firestore
 * 'offline'= Firebase konfigurerat men ingen kontakt — kön väntar
 */

import { firebaseConfig, isFirebaseConfigured } from "../firebase-config.js";
import { readCollection, writeCollection, pathFromStorageKey, collectionPathsUnder } from "./local.js";
import { createFirestoreSync } from "./firestore-sync.js";

const OUTBOX_KEY = "classroom:outbox";
const OUTBOX_LOCK = "classroom-outbox";          // Web Locks-namn
const LEASE_KEY = "classroom:outbox-lease";      // reserv utan Web Locks
const LEASE_TTL_MS = 15000;
const LEASE_RETRY_MS = 2000;
const RETRY_BASE_MS = 300;
const RETRY_MAX_MS = 30000;

// createSync: bara för tester (docs/test-outbox.mjs) — byt molnadaptern mot en attrapp.
export function createDataLayer({ onSyncState, createSync = createFirestoreSync } = {}) {
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
  //  - Varje op får ett unikt `opId` vid enqueue och tas bort ur kön PER
  //    IDENTITET efter lyckad push — aldrig positionellt (slice(1) kunde
  //    radera en annan, opushad op om två flush körde samtidigt).
  //  - Bara EN flush kör åt gången per fönster (promise-spärr som sätts
  //    synkront), och mellan fönster (lärare ↔ elevskärm delar samma
  //    localStorage-outbox) via Web Locks, med ett localStorage-lease som
  //    reserv. Ett flush-anrop under pågående flush tappas inte: kön körs
  //    en gång till efteråt.
  //  - Pushar två fönster ändå samma op är det ofarligt: pushen är en
  //    LWW-transaktion (firestore-sync.js) och därmed idempotent.
  //  - Transaktionskonflikt (failed-precondition/aborted) = försök igen
  //    strax; op:en ligger kvar och synkstatusen påverkas inte.

  const readOutbox = () => {
    try {
      const ops = JSON.parse(localStorage.getItem(OUTBOX_KEY));
      return Array.isArray(ops) ? ops : [];
    } catch { return []; }
  };
  const writeOutbox = (ops) => localStorage.setItem(OUTBOX_KEY, JSON.stringify(ops));

  /** Identitet för en op. Äldre outboxar (före opId) jämförs på innehåll —
   *  två sådana med samma nyckel är samma skrivning och får tas bort ihop. */
  const opKey = (o) => o.opId
    ?? `${o.op}|${o.path}|${o.id}|${o.op === "delete" ? o.at : o.doc?.updatedAt}`;

  function removeFromOutbox(pushed) {
    const key = opKey(pushed);
    writeOutbox(readOutbox().filter((o) => opKey(o) !== key));
  }

  function enqueue(op) {
    if (!isFirebaseConfigured()) return; // rent lokalt läge — ingen kö behövs
    writeOutbox([...readOutbox(), { ...op, opId: newId() }]);
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
      for (let op = readOutbox()[0]; op; op = readOutbox()[0]) {
        await sync.push(op); // kastar vid fel → op ligger kvar
        removeFromOutbox(op);
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
    const local = readCollection(path);
    const merged = { ...local };
    let changed = false;

    // Ta in/uppdatera fjärrdokument — last-write-wins per dokument via updatedAt.
    for (const [id, doc] of Object.entries(remoteDocs)) {
      if (!local[id] || (doc.updatedAt ?? 0) >= (local[id].updatedAt ?? 0)) {
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
      const now = Date.now();
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
      const full = { ...docs[id], ...partial, id, updatedAt: Date.now() };
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
      enqueue({ op: "delete", path, id, at: Date.now() }); // at: LWW mot servern
    },

    /** Alla lagrade samlings-paths under ett prefix (t.ex. "classes/4a/"). */
    async collections(prefix) {
      return collectionPathsUnder(prefix);
    },

    watch(path, cb) {
      if (!watchers.has(path)) watchers.set(path, new Set());
      watchers.get(path).add(cb);
      sync?.watch(path);
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

  // Live-uppdatering mellan flikar/fönster (lärarfönster ↔ elevskärm)
  window.addEventListener("storage", (e) => {
    const path = pathFromStorageKey(e.key);
    if (path && watchers.has(path)) notify(path);
  });

  return api;
}
