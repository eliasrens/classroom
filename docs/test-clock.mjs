/**
 * TEST — skydd mot framtida tidsstämplar (issue #31).
 *
 *   node docs/test-clock.mjs
 *
 * Kör det RIKTIGA datalagret + den RIKTIGA firestore-sync.js mot en
 * attrapp av Firestore-SDK:n (transaktioner, onSnapshot, serverTimestamp,
 * getDocFromServer). Attrappens server har rätt tid; klientens klocka
 * förskjuts genom att byta Date.now. Kontrollerar:
 *   - ett fjärrdokument med updatedAt 4 dagar fram vinner INTE mot en ny
 *     lokal ändring — ändringen når servern med korrekt tid (självläkning)
 *   - en klient vars klocka går 1 dygn fel skriver ändå korrekt servertid
 *     (och ser att klockan avviker → varningen i lärarvyn)
 *   - en ändring gjord offline med fel klocka (innan servertiden är känd)
 *     kläms till "nu" när den väl pushas
 *   - en enhet som har den framtida versionen lokalt tar emot den läkta
 *     versionen (ingen divergens), men en egen opushad ändring står kvar
 *   - veckorytmen: weekOf i framtiden räknas som ogiltig → innevarande vecka
 * Plus enhetstester av klämreglerna i js/lib/clock.js. Varje scenario körs
 * i en egen process (klockmodulen är global per fönster, som i webbläsaren).
 */

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const DAY = 86_400_000;
const MIN = 60_000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const realNow = Date.now.bind(Date);

// ---- Webbläsarglobaler ----

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
  clear: () => store.clear(),
  get length() { return store.size; },
  key: (i) => [...store.keys()][i] ?? null,
};
globalThis.window = new EventTarget();
Object.defineProperty(globalThis, "navigator", { value: {}, configurable: true, writable: true });
localStorage.setItem("classroom:auth:session", "u1"); // inloggad lärare (mätdokumentets path)

/** Förskjut klientens klocka (serverns attrapp använder realNow). */
const skewClock = (ms) => { Date.now = () => realNow() + ms; };

// ---- Attrapp av Firestore-SDK:n ----

function createFakeFirestore() {
  const docs = new Map();          // "a/b/c/d" → data
  const listeners = new Map();     // collectionPath → Set<cb>
  const TS = Symbol("serverTimestamp");
  const stamp = (data) => {
    const out = {};
    for (const [k, v] of Object.entries(data)) {
      if (v === TS) { const ms = realNow(); out[k] = { toMillis: () => ms }; }
      else out[k] = v;
    }
    return out;
  };
  const snapOf = (path) => {
    const d = docs.get(path);
    return { exists: () => d !== undefined, data: () => (d === undefined ? undefined : { ...d }) };
  };
  const parent = (path) => path.split("/").slice(0, -1).join("/");
  const emit = (colPath) => {
    for (const cb of listeners.get(colPath) ?? []) {
      const entries = [...docs].filter(([p]) => parent(p) === colPath);
      setTimeout(() => cb({
        forEach: (fn) => entries.forEach(([p, d]) => fn({ id: p.split("/").pop(), data: () => ({ ...d }) })),
        metadata: { fromCache: false },
      }), 1);
    }
  };
  const write = (path, data, { merge = false } = {}) => {
    docs.set(path, merge ? { ...docs.get(path), ...stamp(data) } : stamp(data));
    emit(parent(path));
  };
  const api = {
    getFirestore: () => ({}),
    doc: (_db, ...segs) => ({ path: segs.join("/") }),
    collection: (_db, ...segs) => ({ path: segs.join("/") }),
    serverTimestamp: () => TS,
    async setDoc(ref, data) { await sleep(2); write(ref.path, data); },
    async getDocFromServer(ref) { await sleep(2); return snapOf(ref.path); },
    async runTransaction(_db, fn) {
      await sleep(1);
      const pending = [];
      const tx = {
        get: async (ref) => snapOf(ref.path),
        set: (ref, data, opts) => { pending.push(() => write(ref.path, data, opts)); },
        delete: (ref) => { pending.push(() => { docs.delete(ref.path); emit(parent(ref.path)); }); },
      };
      const result = await fn(tx);
      pending.forEach((w) => w());
      return result;
    },
    onSnapshot(ref, _opts, next) {
      if (!listeners.has(ref.path)) listeners.set(ref.path, new Set());
      listeners.get(ref.path).add(next);
      emit(ref.path);
      return () => listeners.get(ref.path).delete(next);
    },
  };
  const appMod = { getApps: () => [], getApp: () => ({}), initializeApp: () => ({}) };
  return { docs, api, appMod, seed: (path, data) => docs.set(path, data) };
}

const { createDataLayer } = await import("../js/data/datalayer.js");
const { createFirestoreSync } = await import("../js/data/firestore-sync.js");
const { readCollection, writeCollection } = await import("../js/data/local.js");
const clock = await import("../js/lib/clock.js");
const { planPraiseRollover } = await import("../js/lib/week-rhythm.js");
const { weekKey, addWeeks, startOfWeek } = await import("../js/lib/week.js");

/** Datalager kopplat till attrappen. offline=true: SDK:n kan inte laddas förrän goOnline(). */
function device(fake, { offline = false } = {}) {
  let online = !offline;
  const createSync = (opts) => createFirestoreSync({
    ...opts,
    loadSdk: async () => {
      if (!online) throw new Error("offline (attrapp)");
      return [fake.appMod, fake.api];
    },
  });
  const data = createDataLayer({ createSync });
  return { data, goOnline() { online = true; window.dispatchEvent(new Event("online")); } };
}

const outboxLeft = () => [...store.keys()].filter((k) => k.startsWith("classroom:outbox:")).length;
async function settle(ms = 400) {
  for (let t = 0; t < ms; t += 20) { await sleep(20); if (outboxLeft() === 0 && t > 60) break; }
  await sleep(40);
}

let failures = 0;
function check(ok, what) {
  console.log(`${ok ? "OK " : "FEL"}  ${what}`);
  if (!ok) failures++;
}
const near = (t, ref = realNow(), tol = 5_000) => Math.abs(t - ref) < tol;
const PATH = "classes/test/settings";
const KEY = `${PATH}/morningScreen`;

// ---- Scenarier ----

const scenarios = {
  // Klämreglerna som rena funktioner.
  unit() {
    const now = 1_000_000_000_000;
    const future = now + 4 * DAY;
    check(clock.isFutureStamp(future, now) && !clock.isFutureStamp(now + 2 * MIN, now), "isFutureStamp: 4 dygn = framtid, 2 min = tolerans");
    check(clock.clampStamp(future, now) === now && clock.clampStamp(now - 5, now) === now - 5, "clampStamp: framtid → nu, annars orörd");
    check(!clock.remoteWins({ updatedAt: now }, { updatedAt: future }, { pending: true, now }), "remoteWins: framtida fjärr vinner inte mot opushad lokal ändring");
    check(clock.remoteWins({ updatedAt: now }, { updatedAt: future }, { pending: false, now }), "remoteWins: framtida fjärr gäller mot synkad lokal kopia (servern = sanning)");
    check(clock.remoteWins({ updatedAt: future }, { updatedAt: now - 10, }, { pending: false, now }), "remoteWins: lokal framtida kopia ersätts av läkt fjärrversion");
    check(!clock.remoteWins({ updatedAt: now }, { updatedAt: now - 10 }, { now }), "remoteWins: vanlig LWW oförändrad (äldre fjärr förlorar)");
    check(clock.opBeatsServer(now, future, now) && !clock.opBeatsServer(now - 10, now, now), "opBeatsServer: framtida servertid blockerar aldrig; nyare riktig gör det");
    const clamped = clock.clampDocStamps({ updatedAt: future, createdAt: future, x: 1 }, now);
    check(clamped.updatedAt === now && clamped.createdAt === now && clamped.x === 1, "clampDocStamps: updatedAt/createdAt kläms");
  },

  // Fjärrdokument 4 dygn fram vinner INTE mot en ny lokal ändring.
  async futureRemote() {
    const fake = createFakeFirestore();
    const F = realNow() + 4 * DAY;
    fake.seed(KEY, { id: "morningScreen", value: { note: "gammal" }, createdAt: F, updatedAt: F });
    const { data } = device(fake);
    data.watch(PATH, () => {});
    await settle();
    check((await data.get(PATH, "morningScreen"))?.updatedAt === F, "den framtida versionen hämtas in (servern = sanning)");
    await data.patch(PATH, "morningScreen", { value: { note: "ny" } });
    await settle();
    const srv = fake.docs.get(KEY);
    check(srv.value.note === "ny", "den nya lokala ändringen når servern trots updatedAt 4 dygn fram");
    check(near(srv.updatedAt), "servern får korrekt tid (inte framtiden)");
    const local = await data.get(PATH, "morningScreen");
    check(local.value.note === "ny" && local.updatedAt === srv.updatedAt, "lokalt = servern efteråt");
  },

  // En klient med klockan 1 dygn fel skriver ändå korrekt servertid.
  async skewedClient() {
    skewClock(+DAY);
    const fake = createFakeFirestore();
    const { data } = device(fake);
    data.watch(PATH, () => {});
    await settle();
    const { calibrated, offset } = clock.clockState();
    check(calibrated && near(offset, -DAY), `klockan mätt mot servern (offset ${Math.round(offset / 60_000)} min)`);
    check(Math.abs(offset) > clock.CLOCK_WARN_MS, "avvikelsen > 2 min → lärarvyn visar varningen");
    await data.put(PATH, { id: "morningScreen", value: { note: "från fel klocka" } });
    await settle();
    const srv = fake.docs.get(KEY);
    check(srv && near(srv.updatedAt) && near(srv.createdAt), "updatedAt/createdAt på servern = korrekt tid");
    check(weekKey() === weekKey(realNow()), "veckan räknas på servertid");
  },

  // Ändring offline med fel klocka (servertiden okänd) kläms vid push.
  async offlineSkew() {
    skewClock(+3 * DAY);
    const fake = createFakeFirestore();
    fake.seed(KEY, { id: "morningScreen", value: { note: "server" }, createdAt: realNow() - DAY, updatedAt: realNow() - DAY });
    const dev = device(fake, { offline: true });
    await settle(100);
    await dev.data.put(PATH, { id: "morningScreen", value: { note: "offline" } });
    check(!clock.clockCalibrated() && (await dev.data.get(PATH, "morningScreen")).updatedAt > realNow() + 2 * DAY,
      "offline: lokal tid (3 dygn fram) används tills servern nås");
    dev.data.watch(PATH, () => {});
    dev.goOnline();
    await settle(800);
    const srv = fake.docs.get(KEY);
    check(srv.value.note === "offline" && near(srv.updatedAt), "vid push kläms tidsstämpeln till korrekt servertid");
    const local = await dev.data.get(PATH, "morningScreen");
    check(local.updatedAt === srv.updatedAt, "den lokala (framtida) kopian läks till serverns version");
  },

  // Annan enhet har den framtida versionen lokalt → tar emot den läkta.
  async healOtherDevice() {
    const fake = createFakeFirestore();
    const F = realNow() + 4 * DAY;
    const L = realNow() - 1000;
    writeCollection(PATH, { morningScreen: { id: "morningScreen", value: { note: "framtid" }, createdAt: F, updatedAt: F } });
    fake.seed(KEY, { id: "morningScreen", value: { note: "läkt" }, createdAt: F, updatedAt: L });
    // OBS: students/notes är numera ENDAST LOKALA (issue #32) och synkas
    // aldrig — testet använder sessions (delad samling) i stället.
    writeCollection("classes/test/sessions", { s1: { id: "s1", name: "Lokal", updatedAt: realNow() } });
    fake.seed("classes/test/sessions/s1", { id: "s1", name: "Fjärr-framtid", updatedAt: F });
    const { data } = device(fake);
    data.watch(PATH, () => {});
    await settle();
    check(readCollection(PATH).morningScreen.value.note === "läkt", "enhet med framtida lokal kopia tar emot den läkta versionen (ingen divergens)");
    // Egen opushad ändring mot framtida fjärrversion: står kvar och vinner.
    await data.patch("classes/test/sessions", "s1", { name: "Egen ändring" });
    data.watch("classes/test/sessions", () => {});
    await settle();
    check(readCollection("classes/test/sessions").s1.name === "Egen ändring", "egen opushad ändring står kvar mot framtida fjärrversion");
    check(fake.docs.get("classes/test/sessions/s1").name === "Egen ändring" && near(fake.docs.get("classes/test/sessions/s1").updatedAt),
      "… och når servern med korrekt tid");
  },

  // Veckorytmen: weekOf i framtiden = ogiltig. (Sedan issue #32 ligger
  // Bra jobbat i det LOKALA "board"-dokumentet — plan tar det direkt.)
  weekRhythm() {
    const now = realNow();
    const future = weekKey(addWeeks(startOfWeek(now), 1));
    const board = { id: "board", weekOf: future, praise: [{ id: "p", kind: "free", text: "Bra!" }] };
    const writes = planPraiseRollover(board, "test", now);
    check(writes?.length === 1 && writes[0].doc.weekOf === weekKey(now) && writes[0].doc.praise.length === 1,
      "weekOf i framtiden → innevarande vecka, listan behålls (inget arkiv)");
    const last = weekKey(addWeeks(startOfWeek(now), -1));
    const w2 = planPraiseRollover({ ...board, weekOf: last }, "test", now);
    check(w2?.length === 2 && w2[1].doc.praise.length === 0 && w2[0].path === "classes/test/praiseArchive",
      "förra veckans lista arkiveras + töms som förut");
    check(planPraiseRollover({ ...board, weekOf: weekKey(now) }, "test", now) === null, "innevarande vecka → inget");
  },
};

// ---- Körning: varje scenario i en egen process ----

const only = process.argv[2];
if (only) {
  // Förväntat brus (attrappens "offline", konfliktloggar) — bara fel syns.
  const origWarn = console.warn;
  console.warn = (...a) => { if (!String(a[1] ?? "").includes("offline (attrapp)")) origWarn(...a); };
  await scenarios[only]();
  process.exit(failures ? 1 : 0);
}
let bad = 0;
for (const name of Object.keys(scenarios)) {
  console.log(`\n# ${name}`);
  const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), name], { stdio: "inherit", timeout: 20_000 });
  if (r.status !== 0) bad++;
}
console.log(bad ? "\nFEL HITTADES" : "\nALLA OK");
process.exit(bad ? 1 : 0);
