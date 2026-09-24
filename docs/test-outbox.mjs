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
 * Tre scenarier, fem varv vardera: med Web Locks, med localStorage-lease
 * (ingen Web Locks) och med slumpade externa transaktionskonflikter
 * (retry-vägen).
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
};
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

async function scenario(label, { locks, externalConflictRate = 0 }) {
  setNavigator(locks ? { locks: fakeLocks() } : {});
  const cloud = createCloud({ externalConflictRate });
  const adapters = [];
  const factory = (opts) => { const a = cloud.factory(opts); adapters.push(a); return a; };
  const teacher = createDataLayer({ createSync: factory });
  const student = createDataLayer({ createSync: factory });

  const origWarn = console.warn, origErr = console.error, origInfo = console.info;
  const logged = { warn: 0, error: 0 };
  console.warn = () => { logged.warn++; };
  console.error = () => { logged.error++; };
  console.info = () => {};

  const PATHS = ["classes/4A/settings", "classes/4A/students", "teachers/u1/classes/4A/lessonPlans"];
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
  while (Date.now() < deadline && JSON.parse(localStorage.getItem("classroom:outbox") ?? "[]").length) {
    await sleep(20);
  }
  await sleep(50);
  console.warn = origWarn; console.error = origErr; console.info = origInfo;

  const outbox = JSON.parse(localStorage.getItem("classroom:outbox") ?? "[]");
  const problems = [];
  if (outbox.length) problems.push(`outboxen har ${outbox.length} ops kvar`);
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
  console.log(`${ok ? "OK  " : "FAIL"} ${label} — ${cloud.stats.pushes} pushar, ${cloud.stats.external} externa konflikter`);
  for (const p of problems) console.log("     ·", p);
  return ok;
}

// Varje scenario i en egen process: ett datalager lever vidare efter sitt
// scenario (retry-timers) och skulle annars tömma nästa scenarios outbox.
const SCENARIOS = {
  locks: ["Web Locks", { locks: true }],
  lease: ["localStorage-lease", { locks: false }],
  conflicts: ["externa konflikter", { locks: true, externalConflictRate: 0.25 }],
};
const only = process.argv[2];
if (only) {
  const [label, opts] = SCENARIOS[only];
  process.exit((await scenario(`${label} #${process.argv[3]}`, opts)) ? 0 : 1);
}

const { spawnSync } = await import("node:child_process");
const { fileURLToPath } = await import("node:url");
let allOk = true;
for (let run = 1; run <= 5; run++) {
  for (const name of Object.keys(SCENARIOS)) {
    const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), name, String(run)], { stdio: "inherit" });
    allOk = r.status === 0 && allOk;
  }
}
console.log(allOk ? "\nALLA OK" : "\nFEL HITTADES");
process.exit(allOk ? 0 : 1);
