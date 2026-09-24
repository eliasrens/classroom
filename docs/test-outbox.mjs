/**
 * TEST — outbox-flush (issue #30).
 *
 *   node docs/test-outbox.mjs
 *
 * Kör datalagret i Node mot en attrapp av Firestore (LWW-transaktion som
 * kastar failed-precondition om samma dokument redan skrivs). Två
 * datalager-instanser delar SAMMA localStorage — som lärarfönstret och
 * elevskärmen i webbläsaren. 20 snabba skrivningar (samma + olika
 * dokument, set/patch/delete) medan flush triggas från flera håll
 * (enqueue, setSyncState online, window online-event). Kontrollerar:
 *   - outboxen blir tom
 *   - molnets slutläge == lokalt slutläge (ingen op tappad)
 *   - inga samtidiga pushar (= inga failed-precondition) mellan/inom fönster
 * Fyra scenarier, fem varv vardera: med Web Locks, med localStorage-lease
 * (ingen Web Locks), med slumpade externa transaktionskonflikter
 * (retry-vägen) och med en outbox i det gamla array-formatet (före #30).
 * Plus ett deterministiskt backoff-test (konflikter mellan lyckade pushar
 * får inte dubbla väntan).
 *
 *   node docs/test-outbox.mjs backoff        — bara backoff-testet
 *   node docs/test-outbox.mjs conflicts 1    — ett scenario, ett varv
 */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = (a, b) => a + Math.floor(Math.random() * (b - a + 1));

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
/** Allt som ligger kvar i outboxen: egna op-nycklar + ev. gammal array-kö. */
const outboxLeft = () =>
  [...store.keys()].filter((k) => k.startsWith("classroom:outbox:")).length
  + JSON.parse(localStorage.getItem("classroom:outbox") ?? "[]").length;
globalThis.window = new EventTarget();

/** Minimal Web Locks: exklusivt, FIFO, per namn. */
function fakeLocks() {
  const queues = new Map();
  return {
    async request(name, cb) {
      const prev = queues.get(name) ?? Promise.resolve();
      let release;
      const mine = new Promise((r) => { release = r; });
      queues.set(name, prev.then(() => mine));
      await prev;
      try { return await cb({ name }); } finally { release(); }
    },
  };
}
const setNavigator = (nav) =>
  Object.defineProperty(globalThis, "navigator", { value: nav, configurable: true, writable: true });

const { createDataLayer } = await import("../js/data/datalayer.js");
const { readCollection } = await import("../js/data/local.js");

// ---- Molnattrapp ----

function createCloud({ externalConflictRate = 0 } = {}) {
  const docs = new Map();      // "path/id" → doc
  const inflight = new Set();  // "path/id" under transaktion
  const stats = { pushes: 0, overlaps: 0, external: 0 };

  const factory = ({ onStatus }) => {
    let started = false;
    return {
      async start() {
        if (!started) { await sleep(rand(1, 5)); started = true; onStatus?.("online"); }
        return true;
      },
      watch() {},
      reset() {},
      onStatus: (s) => onStatus?.(s),
      async push(op) {
        stats.pushes++;
        const key = `${op.path}/${op.id}`;
        await sleep(rand(0, 3));
        if (inflight.has(key)) {
          stats.overlaps++;
          throw Object.assign(new Error("samtidig transaktion"), { code: "failed-precondition" });
        }
        if (Math.random() < externalConflictRate) {
          stats.external++;
          throw Object.assign(new Error("extern konflikt"), { code: "aborted" });
        }
        inflight.add(key);
        try {
          await sleep(rand(1, 4));
          const opTime = op.op === "delete" ? op.at : op.doc?.updatedAt;
          const serverTime = docs.get(key)?.updatedAt ?? 0;
          if (opTime != null && serverTime > opTime) return;
          if (op.op === "delete") docs.delete(key);
          else docs.set(key, op.op === "patch" ? { ...docs.get(key), ...op.doc } : op.doc);
        } finally {
          inflight.delete(key);
        }
      },
    };
  };
  return { docs, stats, factory };
}

// ---- Scenario ----

async function scenario(label, { locks, externalConflictRate = 0, legacy = false }) {
  setNavigator(locks ? { locks: fakeLocks() } : {});
  // OBS: students/notes är ENDAST LOKALA sedan issue #32 (köas aldrig) —
  // testet använder bara synkade samlingar.
  const PATHS = ["classes/4A/settings", "classes/4A/sessions", "teachers/u1/classes/4A/lessonPlans"];
  if (legacy) {
    // Outbox i det gamla formatet (en array, ops utan opId) från före #30.
    const t = Date.now() - 1000;
    const docs = [0, 1, 2].map((k) => ({ id: `legacy${k}`, n: -1, createdAt: t, updatedAt: t + k }));
    localStorage.setItem("classroom:data:" + PATHS[1], JSON.stringify(Object.fromEntries(docs.map((d) => [d.id, d]))));
    localStorage.setItem("classroom:outbox", JSON.stringify(docs.map((doc) => ({ op: "set", path: PATHS[1], id: doc.id, doc }))));
  }
  const cloud = createCloud({ externalConflictRate });
  const adapters = [];
  const factory = (opts) => { const a = cloud.factory(opts); adapters.push(a); return a; };
  const teacher = createDataLayer({ createSync: factory });
  const student = createDataLayer({ createSync: factory });

  const origWarn = console.warn, origErr = console.error, origInfo = console.info;
  const logged = { warn: 0, error: 0 };
  console.warn = () => { logged.warn++; };
  console.error = () => { logged.error++; };
  const backoffs = [];
  console.info = (msg) => { const m = /om (\d+) ms/.exec(String(msg)); if (m) backoffs.push(Number(m[1])); };

  const layers = [teacher, student];
  for (let i = 0; i < 20; i++) {
    const data = layers[i % 2];
    const path = PATHS[i % PATHS.length];
    const id = i % 4 === 0 ? "lektion" : `doc${i % 7}`; // samma dokument om och om igen + olika
    const existing = await data.get(path, id);
    const r = Math.random();
    if (existing && r < 0.2) await data.remove(path, id);
    else if (existing && r < 0.5) await data.patch(path, id, { n: i });
    else await data.put(path, { id, n: i, activePlanId: `p${i}` });

    // Flush från flera håll samtidigt
    if (i % 3 === 0) adapters[i % adapters.length].onStatus("offline");
    if (i % 3 === 1) adapters[i % adapters.length].onStatus("online");
    if (i % 5 === 0) window.dispatchEvent(new Event("online"));
    if (i % 4 === 0) await sleep(rand(0, 2));
  }

  // Vänta in att kön töms (retry-timers vid konflikter inräknade).
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline && outboxLeft()) {
    await sleep(20);
  }
  await sleep(50);
  console.warn = origWarn; console.error = origErr; console.info = origInfo;

  const problems = [];
  if (outboxLeft()) problems.push(`outboxen har ${outboxLeft()} ops kvar`);
  if (legacy) {
    for (const k of [0, 1, 2]) {
      if (!cloud.docs.has(`${PATHS[1]}/legacy${k}`)) problems.push(`gammal op legacy${k} pushades aldrig`);
    }
  }
  for (const path of PATHS) {
    const local = readCollection(path);
    const cloudIds = [...cloud.docs.keys()].filter((k) => k.startsWith(path + "/") && !k.slice(path.length + 1).includes("/"));
    for (const [id, doc] of Object.entries(local)) {
      const remote = cloud.docs.get(`${path}/${id}`);
      if (!remote) problems.push(`${path}/${id} saknas i molnet`);
      else if (remote.updatedAt !== doc.updatedAt || remote.n !== doc.n) problems.push(`${path}/${id} skiljer sig (lokal n=${doc.n}, moln n=${remote.n})`);
    }
    for (const key of cloudIds) {
      if (!local[key.slice(path.length + 1)]) problems.push(`${key} borde vara raderad i molnet`);
    }
  }
  if (cloud.stats.overlaps) problems.push(`${cloud.stats.overlaps} samtidiga pushar av samma dokument (failed-precondition)`);
  if (logged.error) problems.push(`${logged.error} console.error`);
  if (!externalConflictRate && logged.warn) problems.push(`${logged.warn} console.warn`);

  const ok = problems.length === 0;
  console.log(`${ok ? "OK  " : "FAIL"} ${label} — ${cloud.stats.pushes} pushar, ${cloud.stats.external} externa konflikter`
    + (backoffs.length ? `, backoff max ${Math.max(...backoffs)} ms (summa ${backoffs.reduce((a, b) => a + b, 0)} ms)` : ""));
  for (const p of problems) console.log("     ·", p);
  return ok;
}

// ---- Deterministiskt: backoff vid konflikter ----
//
// Regression (flakigheten i "externa konflikter"): backoffen får bara växa
// vid konflikter I RAD. Enstaka konflikter mellan lyckade pushar ska ge
// RETRY_BASE_MS varje gång — tidigare dubblades väntan ändå (300 → 600 →
// … → 30 000 ms) eftersom räknaren bara nollställdes när HELA kön tömts.
// Molnet är skriptat (ingen slump): op 1, 3, 5 och 7 får en konflikt var,
// op 8 får tre i rad.

async function backoffScenario() {
  setNavigator({ locks: fakeLocks() });
  const conflictsLeft = new Map([["d1", 1], ["d3", 1], ["d5", 1], ["d7", 1], ["d8", 3]]);
  const pushed = [];
  const createSync = ({ onStatus }) => ({
    async start() { onStatus?.("online"); return true; },
    watch() {}, reset() {},
    async push(op) {
      const left = conflictsLeft.get(op.id) ?? 0;
      if (left > 0) {
        conflictsLeft.set(op.id, left - 1);
        throw Object.assign(new Error("extern konflikt"), { code: "aborted" });
      }
      pushed.push(op.id);
    },
  });
  const origInfo = console.info, origWarn = console.warn, origErr = console.error;
  const backoffs = [], logged = { warn: 0, error: 0 };
  console.info = (msg) => { const m = /om (\d+) ms/.exec(String(msg)); if (m) backoffs.push(Number(m[1])); };
  console.warn = () => { logged.warn++; };
  console.error = () => { logged.error++; };

  const data = createDataLayer({ createSync });
  // Köa allt synkront (utan await mellan) så att en och samma flush tömmer kön.
  for (let i = 0; i <= 8; i++) void data.put("classes/4A/settings", { id: `d${i}`, n: i });

  const deadline = Date.now() + 15000;
  while (Date.now() < deadline && outboxLeft()) await sleep(20);
  console.info = origInfo; console.warn = origWarn; console.error = origErr;

  const expected = [300, 300, 300, 300, 300, 600, 1200];
  const problems = [];
  if (outboxLeft()) problems.push(`outboxen har ${outboxLeft()} ops kvar`);
  if (JSON.stringify(backoffs) !== JSON.stringify(expected)) problems.push(`backoff ${JSON.stringify(backoffs)}, väntat ${JSON.stringify(expected)}`);
  if (new Set(pushed).size !== 9) problems.push(`pushade ${JSON.stringify(pushed)}`);
  if (logged.error || logged.warn) problems.push(`${logged.error} console.error, ${logged.warn} console.warn`);
  const ok = problems.length === 0;
  console.log(`${ok ? "OK  " : "FAIL"} backoff (deterministisk) — ${JSON.stringify(backoffs)}`);
  for (const p of problems) console.log("     ·", p);
  return ok;
}

// Varje scenario i en egen process: ett datalager lever vidare efter sitt
// scenario (retry-timers) och skulle annars tömma nästa scenarios outbox.
const SCENARIOS = {
  locks: ["Web Locks", { locks: true }],
  lease: ["localStorage-lease", { locks: false }],
  conflicts: ["externa konflikter", { locks: true, externalConflictRate: 0.25 }],
  legacy: ["gammal array-outbox", { locks: true, legacy: true }],
};
const only = process.argv[2];
if (only === "backoff") process.exit((await backoffScenario()) ? 0 : 1);
if (only) {
  const [label, opts] = SCENARIOS[only];
  process.exit((await scenario(`${label} #${process.argv[3]}`, opts)) ? 0 : 1);
}

const { spawnSync } = await import("node:child_process");
const { fileURLToPath } = await import("node:url");
let allOk = spawnSync(process.execPath, [fileURLToPath(import.meta.url), "backoff"], { stdio: "inherit" }).status === 0;
for (let run = 1; run <= 5; run++) {
  for (const name of Object.keys(SCENARIOS)) {
    const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), name, String(run)], { stdio: "inherit" });
    allOk = r.status === 0 && allOk;
  }
}
console.log(allOk ? "\nALLA OK" : "\nFEL HITTADES");
process.exit(allOk ? 0 : 1);
