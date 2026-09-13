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
import { readCollection, writeCollection, pathFromStorageKey } from "./local.js";
import { createFirestoreSync } from "./firestore-sync.js";

const OUTBOX_KEY = "classroom:outbox";

export function createDataLayer({ onSyncState } = {}) {
  const watchers = new Map(); // path → Set<cb>
  let syncState = "local";
  let sync = null;
  let flushing = false;

  const newId = () =>
    (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`);

  function setSyncState(next) {
    if (next === syncState) return;
    syncState = next;
    onSyncState?.(next);
  }

  function notify(path) {
    const docs = Object.values(readCollection(path));
    for (const cb of watchers.get(path) ?? []) {
      try { cb(docs); } catch (err) { console.warn(`[data] watcher för "${path}":`, err); }
    }
  }

  // ---- Outbox ----

  const readOutbox = () => {
    try { return JSON.parse(localStorage.getItem(OUTBOX_KEY)) ?? []; } catch { return []; }
  };
  const writeOutbox = (ops) => localStorage.setItem(OUTBOX_KEY, JSON.stringify(ops));

  function enqueue(op) {
    if (!isFirebaseConfigured()) return; // rent lokalt läge — ingen kö behövs
    writeOutbox([...readOutbox(), op]);
    void flush();
  }

  /** Försök tömma outboxen mot Firestore. Ofarlig att anropa när som helst. */
  async function flush() {
    if (flushing || !sync) return;
    if (!(await sync.start())) return;
    flushing = true;
    try {
      let queue = readOutbox();
      while (queue.length > 0) {
        await sync.push(queue[0]); // kastar vid fel → op ligger kvar
        queue = readOutbox().slice(1);
        writeOutbox(queue);
      }
      setSyncState("online");
    } catch (err) {
      console.warn("[data] synk pausad, försöker igen senare:", err);
      setSyncState("offline");
    } finally {
      flushing = false;
    }
  }

  // ---- Merge av fjärrdata (last-write-wins per dokument) ----

  function mergeRemote(path, remoteDocs) {
    const local = readCollection(path);
    const merged = { ...local };
    let changed = false;
    for (const [id, doc] of Object.entries(remoteDocs)) {
      if (!local[id] || (doc.updatedAt ?? 0) >= (local[id].updatedAt ?? 0)) {
        if (JSON.stringify(local[id]) !== JSON.stringify(doc)) {
          merged[id] = { ...doc, id };
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
      enqueue({ op: "delete", path, id });
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
    sync = createFirestoreSync({
      firebaseConfig,
      onRemoteDocs: mergeRemote,
      onStatus: setSyncState,
    });
    void flush();
    window.addEventListener("online", () => void flush());
  }

  // Live-uppdatering mellan flikar/fönster (lärarfönster ↔ elevskärm)
  window.addEventListener("storage", (e) => {
    const path = pathFromStorageKey(e.key);
    if (path && watchers.has(path)) notify(path);
  });

  return api;
}
