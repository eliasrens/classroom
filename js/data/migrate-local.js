/**
 * ENGÅNGSMIGRERING TILL LOKAL ELEVDATA (issue #32).
 *
 * Körs vid varje uppstart INNAN datalagret kopplar några Firestore-
 * lyssnare (anropas synkront först i createDataLayer). Första gången
 * (markören saknas) görs:
 *
 *  1. Elevlistan, noteringarna, Bra jobbat (praise/weekOf i
 *     settings/morningScreen) och veckoarkivet (praiseArchive) kopieras
 *     från DATALAGRETS cache (classroom:data:…) till den lokala
 *     lagringen (classroom:local:…, se js/data/local-only.js). Så
 *     behåller varje lärardator sina elever utan omskrivning — även om
 *     en annan lärare redan har rensat molnet (den lokala cachen finns
 *     ju kvar tills en auktoritativ snapshot tömt den, och migreringen
 *     hinner alltid före eftersom lyssnarna inte startats ännu).
 *  2. Elevdatan rensas ur datalagrets cache (students/notes/
 *     praiseArchive tas bort; praise/weekOf strippas ur morningScreen)
 *     så att inget elevspecifikt ligger kvar i den synkade delen.
 *  3. Gamla outbox-ops saneras — BÅDA formaten (en nyckel per op från
 *     #30 och den äldre arrayen under classroom:outbox) — så att ingen
 *     kölagd op kan skriva tillbaka elevdata till molnet: ops mot
 *     students/notes/praiseArchive tas bort, och morningScreen-ops får
 *     praise/weekOf strippade.
 *
 * Efteråt sätts markören. Allt är idempotent — körs den två gånger
 * (t.ex. två fönster som startar samtidigt) blir resultatet detsamma.
 * Gallringsinställningen (settings/privacy → noteRetentionWeeks)
 * kopieras också till den lokala privacy-samlingen (nu en lokal
 * inställning, standard 12 veckor — se js/lib/privacy.js).
 */

import { readCollection, writeCollection, storageKeyFor, pathFromStorageKey } from "./local.js";
import { readLocalCollection, writeLocalCollection, isLocalOnlyPath } from "./local-only.js";

const MARKER_KEY = "classroom:local:migrated";
const OUTBOX_PREFIX = "classroom:outbox:";
const OUTBOX_KEY = "classroom:outbox";

/** Klass-id:n som har någon cachead samling i datalagret. */
function cachedClassIds() {
  const ids = new Set();
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const path = pathFromStorageKey(localStorage.key(i));
      const m = /^classes\/([^/]+)\//.exec(path ?? "");
      if (m) ids.add(m[1]);
    }
  } catch { /* lagring otillgänglig */ }
  return [...ids];
}

/** Flytta en hel samling cache → lokal lagring (lokala dokument vinner). */
function moveCollection(from, to = from) {
  const cached = readCollection(from);
  if (Object.keys(cached).length > 0) {
    writeLocalCollection(to, { ...cached, ...readLocalCollection(to) });
  }
  try { localStorage.removeItem(storageKeyFor(from)); } catch { /* ok */ }
}

/** Strippa elevspecifika fält ur ett morningScreen-värde. → { value, hadPraise } */
function stripPraise(value) {
  if (!value || typeof value !== "object") return { value, hadPraise: false };
  const { praise, weekOf, ...rest } = value;
  return { value: rest, hadPraise: praise !== undefined || weekOf !== undefined, praise, weekOf };
}

function migrateClass(cid) {
  moveCollection(`classes/${cid}/students`);
  moveCollection(`classes/${cid}/notes`);
  moveCollection(`classes/${cid}/praiseArchive`);

  const settings = readCollection(`classes/${cid}/settings`);
  let changed = false;

  // Bra jobbat: praise/weekOf ur morningScreen → lokal praise/board.
  const morning = settings.morningScreen;
  if (morning?.value) {
    const { value, hadPraise, praise, weekOf } = stripPraise(morning.value);
    if (hadPraise) {
      const boardPath = `classes/${cid}/praise`;
      const boards = readLocalCollection(boardPath);
      if (!boards.board) {
        boards.board = {
          id: "board",
          praise: Array.isArray(praise) ? praise : [],
          weekOf: typeof weekOf === "string" ? weekOf : null,
          createdAt: morning.createdAt ?? Date.now(),
          updatedAt: morning.updatedAt ?? Date.now(),
        };
        writeLocalCollection(boardPath, boards);
      }
      settings.morningScreen = { ...morning, value };
      changed = true;
    }
  }

  // Gallringsinställningen blir lokal (dokumentet i molnet lämnas orört).
  // SKYDD: hade datorn "Spara tills vidare" (null) eller ingen inställning
  // alls — det gamla standardvalet — får den INTE tyst börja gallra med
  // nya standardvärdet 12 veckor: lokala noteringar finns bara här och
  // hade raderats oåterkalleligt vid första öppningen. awaitingChoice
  // pausar gallringen (js/lib/privacy.js) tills läraren aktivt bekräftar
  // en lagringstid i Översikten.
  const weeks = settings.privacy?.value?.noteRetentionWeeks;
  const privacyPath = `classes/${cid}/privacy`;
  const local = readLocalCollection(privacyPath);
  if (!local.privacy) {
    local.privacy = Number.isFinite(weeks) && weeks > 0
      ? { id: "privacy", value: { noteRetentionWeeks: weeks }, updatedAt: Date.now() }
      : { id: "privacy", value: { noteRetentionWeeks: 12, awaitingChoice: true }, updatedAt: Date.now() };
    writeLocalCollection(privacyPath, local);
  }

  if (changed) writeCollection(`classes/${cid}/settings`, settings);
}

/** Sanera en op. → op (ev. omskriven) eller null (ska bort ur kön). */
function scrubOp(op) {
  if (!op || typeof op !== "object") return null;
  if (isLocalOnlyPath(op.path)) return null; // elevdata — får aldrig pushas
  if (op.id === "morningScreen" && /^classes\/[^/]+\/settings$/.test(op.path ?? "") && op.doc?.value) {
    const { value, hadPraise } = stripPraise(op.doc.value);
    if (hadPraise) return { ...op, doc: { ...op.doc, value } };
  }
  return op;
}

function scrubOutbox() {
  // Nya formatet: en nyckel per op.
  const keys = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(OUTBOX_PREFIX)) keys.push(k);
    }
  } catch { return; }
  for (const key of keys) {
    try {
      const op = JSON.parse(localStorage.getItem(key));
      const next = scrubOp(op);
      if (next == null) localStorage.removeItem(key);
      else if (next !== op) localStorage.setItem(key, JSON.stringify(next));
    } catch { localStorage.removeItem(key); }
  }
  // Gamla array-kön (före #30).
  try {
    const legacy = JSON.parse(localStorage.getItem(OUTBOX_KEY));
    if (Array.isArray(legacy)) {
      const rest = legacy.map(scrubOp).filter(Boolean);
      if (rest.length) localStorage.setItem(OUTBOX_KEY, JSON.stringify(rest));
      else localStorage.removeItem(OUTBOX_KEY);
    }
  } catch { /* trasig gammal kö — datalagret städar den */ }
}

/**
 * Kör migreringen om den inte redan är gjord i den här webbläsaren.
 * MÅSTE anropas innan några Firestore-lyssnare kopplas.
 */
export function migrateStudentDataToLocal() {
  try {
    if (localStorage.getItem(MARKER_KEY)) {
      scrubOutbox(); // billig extra säkerhet: inga elev-ops får ligga kvar
      return false;
    }
  } catch { return false; }
  for (const cid of cachedClassIds()) migrateClass(cid);
  scrubOutbox();
  try { localStorage.setItem(MARKER_KEY, "1"); } catch { /* ok */ }
  return true;
}
