/**
 * TEST — "Skicka kopia till klass…" (issue #103), js/lib/send-plan.js.
 *
 *   node docs/test-send-plan.mjs
 *
 * Kontrollerar:
 *   - kopians fält: nytt id, ownerUid = nuvarande lärare, namn/ämne/fält/show
 *     kopierade (djupt — originalet påverkas inte)
 *   - datum och tider tas från dialogen (och behålls vid flera på en gång)
 *   - kopian sparas i målklassens PRIVATA plansPath, originalet orört
 *   - eget ämne läggs till i målklassens settings/subjects, dubbleras inte om
 *     det redan finns, och andra lärares egna ämnen där ligger kvar;
 *     inbyggda ämnen skriver ingenting
 *   - dubblettdetektering: samma namn samma datum, bara MINA planeringar
 *   - presentedPlanId är orört (och en kopia tar aldrig över elevskärmens
 *     förval i en klass där läraren inte valt något)
 *   - presentedPlanOf (flyttad till js/data/plans.js)
 */

const {
  buildCopy, withSubject, isBuiltinSubject, ensureSubjectInClass, findDuplicates,
  sendPlanCopies, classSettingsPath, SUBJECTS_DOC,
} = await import("../js/lib/send-plan.js");
const {
  plansPath, currentUid, lessonSettingsPath, LESSON_SETTINGS_DOC, presentedPlanOf,
} = await import("../js/data/plans.js");
const { SUBJECTS } = await import("../js/lib/color.js");

let failed = 0;
let passed = 0;
function ok(cond, msg) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`FEL: ${msg}`);
}

/** Attrapp för datalagret: samlingar i minnet, once = lokal villkorad skrivning. */
function fakeData(seed = {}) {
  const store = new Map(Object.entries(seed).map(([p, docs]) => [p, Object.fromEntries(docs.map((d) => [d.id, d]))]));
  const writes = [];
  let n = 0;
  const col = (p) => store.get(p) ?? {};
  const api = {
    store, writes,
    async list(p) { return Object.values(col(p)); },
    async get(p, id) { return col(p)[id] ?? null; },
    async put(p, doc) {
      const id = doc.id ?? `ny-${++n}`;
      store.set(p, { ...col(p), [id]: { ...doc, id } });
      writes.push({ path: p, id });
      return id;
    },
    async once(p, id, plan) {
      const w = plan(col(p)[id] ?? null);
      if (!w?.length) return false;
      for (const x of w) await api.put(x.path, x.doc);
      return true;
    },
    watch() { return () => {}; },
  };
  return api;
}

const uid = currentUid();
const SRC = {
  id: "plan-1", ownerUid: uid, name: "Bråk intro", date: "2026-09-29", subjectId: "ma",
  start: "08:10", end: "09:00",
  fields: { vad: "Bråk", hur: "", varfor: "", attGora: ["Läs s. 12", "Gör 1–5"], narKlar: "Spela", duBehover: "Bok", mal: "Förstå 1/2" },
  show: { subject: true, time: true, vad: true, hur: false, varfor: false, attGora: true, narKlar: true, duBehover: false, mal: true, praise: false },
  createdAt: 1, updatedAt: 2,
};

// --- buildCopy: kopians fält -------------------------------------------------
{
  const c = buildCopy(SRC, { date: "2026-09-30", start: "10:10", end: "11:00" }, "larare-x");
  ok(c.id === undefined, "kopian har inget id (får ett nytt vid put)");
  ok(c.ownerUid === "larare-x", "ownerUid = nuvarande lärare");
  ok(buildCopy(SRC).ownerUid === uid, "ownerUid förvalt = currentUid()");
  ok(c.name === "Bråk intro", "namnet kopieras oförändrat (inget '(kopia)')");
  ok(c.subjectId === "ma", "ämnet kopieras");
  ok(JSON.stringify(c.fields) === JSON.stringify(SRC.fields), "fälten kopieras");
  ok(JSON.stringify(c.show) === JSON.stringify(SRC.show), "show kopieras");
  ok(!("createdAt" in c) && !("updatedAt" in c), "tidsstämplar följer inte med");
  c.fields.attGora.push("ändrad");
  c.show.vad = false;
  ok(SRC.fields.attGora.length === 2 && SRC.show.vad === true, "djup kopia — originalet påverkas inte");
}

// --- datum och tider från dialogen ------------------------------------------
{
  const c = buildCopy(SRC, { date: "2026-10-01", start: "10:10", end: "11:00" });
  ok(c.date === "2026-10-01" && c.start === "10:10" && c.end === "11:00", "datum och tider tas från dialogen");
  const same = buildCopy(SRC, {});
  ok(same.date === SRC.date && same.start === SRC.start && same.end === SRC.end,
    "flera på en gång: varje planering behåller sina datum och tider");
  const cleared = buildCopy(SRC, { date: "2026-10-01", start: "", end: "" });
  ok(cleared.start === "" && cleared.end === "", "tömda tider i dialogen blir tomma, inte originalets");
}

// --- sendPlanCopies: rätt klass, oberoende kopia ------------------------------
{
  const data = fakeData({
    [plansPath("4a")]: [SRC],
    [plansPath("4b")]: [],
    [lessonSettingsPath("4b")]: [{ id: LESSON_SETTINGS_DOC, value: { presentedPlanId: "annan" } }],
  });
  const copy = buildCopy(SRC, { date: "2026-09-29", start: "10:10", end: "11:00" });
  const ids = await sendPlanCopies(data, { targetCid: "4b", copies: [copy], subjects: SUBJECTS });
  const saved = await data.get(plansPath("4b"), ids[0]);
  ok(ids.length === 1 && ids[0] && ids[0] !== SRC.id, "kopian får ett nytt id");
  ok(saved?.name === "Bråk intro" && saved.start === "10:10" && saved.end === "11:00",
    "kopian sparas i målklassens plansPath med dialogens tider");
  ok(plansPath("4b").startsWith(`teachers/${uid}/`), "målet är lärarens PRIVATA planeringar");
  ok((await data.list(plansPath("4a"))).length === 1 && (await data.get(plansPath("4a"), SRC.id)).start === "08:10",
    "originalet i den egna klassen är orört");
  // presentedPlanId orört
  const lek = await data.get(lessonSettingsPath("4b"), LESSON_SETTINGS_DOC);
  ok(lek.value.presentedPlanId === "annan", "målklassens presentedPlanId är orört");
  ok(!data.writes.some((w) => w.path === lessonSettingsPath("4b")), "målklassens settings/lektion skrivs inte alls");
  ok(!data.writes.some((w) => w.path === lessonSettingsPath("4a")), "den egna klassens settings/lektion skrivs inte");
  ok(!data.writes.some((w) => w.path === classSettingsPath("4b")), "inbyggt ämne → målklassens ämnen rörs inte");
}

// --- presentedPlanId: kopian tar aldrig över förvalet --------------------------
{
  // Målklassen har inget settings/lektion → elevskärmen visar "dagens
  // planering" som förval. En kopia dagens datum får inte ta över.
  const now = new Date(2026, 8, 29, 10, 30).getTime(); // tis 29 sep 10:30
  const befintlig = { id: "b-1", ownerUid: uid, name: "Svenska", date: "2026-09-29", start: "08:00", end: "09:00" };
  const data = fakeData({ [plansPath("4b")]: [befintlig] });
  ok(presentedPlanOf([befintlig], null, now)?.id === "b-1", "förutsättning: förvalet är den befintliga");
  const copy = buildCopy(SRC, { date: "2026-09-29", start: "10:10", end: "11:00" });
  const [id] = await sendPlanCopies(data, { targetCid: "4b", copies: [copy], subjects: SUBJECTS, now });
  const plans = await data.list(plansPath("4b"));
  const lek = await data.get(lessonSettingsPath("4b"), LESSON_SETTINGS_DOC);
  ok(presentedPlanOf(plans, null, now)?.id === id, "utan låsning hade kopian (10:10) tagit över förvalet");
  ok(lek?.value?.presentedPlanId === "b-1", "förvalet låses på det som visades innan — kopian visas inte");
  ok(presentedPlanOf(plans, lek, now)?.id === "b-1", "elevskärmen visar fortfarande samma planering");

  const tom = fakeData({});
  await sendPlanCopies(tom, { targetCid: "4c", copies: [buildCopy(SRC)], subjects: SUBJECTS, now });
  const lekTom = await tom.get(lessonSettingsPath("4c"), LESSON_SETTINGS_DOC);
  ok(lekTom?.value?.presentedPlanId === null, "tom målklass → elevskärmen förblir tom (inte kopian)");
}

// --- eget ämne ---------------------------------------------------------------
{
  const EGET = { id: "eget-klassrad-x1y", name: "Klassråd", color: "#4e8f72" };
  const ANNAT = { id: "eget-slojd-q9", name: "Slöjd extra", color: "#aa5500" };
  const subjects = [...SUBJECTS, EGET];
  ok(!isBuiltinSubject(EGET.id) && isBuiltinSubject("ma"), "isBuiltinSubject skiljer eget från inbyggt");

  ok(withSubject([], EGET)?.length === 1, "withSubject lägger till i tom lista");
  ok(withSubject(undefined, EGET)?.[0]?.id === EGET.id, "withSubject tål saknad lista");
  ok(withSubject([EGET], EGET) === null, "withSubject: finns redan → null (ingen skrivning)");
  ok(JSON.stringify(Object.keys(withSubject([], { ...EGET, extra: 1 })[0])) === JSON.stringify(["id", "name", "color"]),
    "bara id, namn och färg följer med");

  const data = fakeData({
    [classSettingsPath("4b")]: [
      { id: SUBJECTS_DOC, value: { list: [ANNAT] } },
      { id: "names", value: { mode: "first" } },
    ],
  });
  const copy = buildCopy({ ...SRC, subjectId: EGET.id }, {});
  await sendPlanCopies(data, { targetCid: "4b", copies: [copy], subjects });
  const list = (await data.get(classSettingsPath("4b"), SUBJECTS_DOC)).value.list;
  ok(list.some((s) => s.id === EGET.id && s.name === "Klassråd" && s.color === "#4e8f72"),
    "eget ämne läggs till i målklassens settings/subjects (id, namn, färg)");
  ok(list.some((s) => s.id === ANNAT.id), "målklassens andra egna ämnen ligger kvar");
  ok((await data.get(classSettingsPath("4b"), "names")).value.mode === "first", "andra inställningar rörs inte");
  const subjWrite = data.writes.findIndex((w) => w.path === classSettingsPath("4b"));
  const planWrite = data.writes.findIndex((w) => w.path === plansPath("4b"));
  ok(subjWrite >= 0 && subjWrite < planWrite, "ämnet läggs till FÖRE planeringen");

  // Skicka igen → ingen dubblett
  const before = data.writes.length;
  await sendPlanCopies(data, { targetCid: "4b", copies: [copy], subjects });
  const list2 = (await data.get(classSettingsPath("4b"), SUBJECTS_DOC)).value.list;
  ok(list2.filter((s) => s.id === EGET.id).length === 1, "eget ämne dubbleras inte om det redan finns");
  ok(!data.writes.slice(before).some((w) => w.path === classSettingsPath("4b")), "…och inget skrivs till ämnena");

  // Två kopior med samma egna ämne → en skrivning
  const d2 = fakeData({});
  await sendPlanCopies(d2, { targetCid: "4c", copies: [copy, { ...copy, name: "Annan" }], subjects });
  ok(d2.writes.filter((w) => w.path === classSettingsPath("4c")).length === 1, "flera kopior, samma ämne → en skrivning");
  ok((await d2.get(classSettingsPath("4c"), SUBJECTS_DOC)).value.list.length === 1, "målklass utan egna ämnen får listan skapad");

  ok(await ensureSubjectInClass(fakeData({}), "4c", "ma", subjects) === false, "inbyggt ämne → ingen skrivning");
  ok(await ensureSubjectInClass(fakeData({}), "4c", "okant", subjects) === false, "okänt ämne → ingen skrivning");
}

// --- dubblettdetektering -------------------------------------------------------
{
  const target = [
    { id: "t1", ownerUid: uid, name: "Bråk intro", date: "2026-09-29" },
    { id: "t2", ownerUid: "annan-larare", name: "Engelska", date: "2026-09-29" },
    { id: "t3", name: "  NO – Växter ", date: "2026-10-01" }, // saknar ownerUid → min (privat path)
  ];
  const c = (name, date) => ({ name, date });
  ok(findDuplicates(target, [c("Bråk intro", "2026-09-29")]).length === 1, "samma namn samma datum → dubblett");
  ok(findDuplicates(target, [c("bråk intro ", "2026-09-29")]).length === 1, "skiftläge/mellanslag spelar ingen roll");
  ok(findDuplicates(target, [c("Bråk intro", "2026-09-30")]).length === 0, "annat datum → ingen dubblett");
  ok(findDuplicates(target, [c("Bråk forts", "2026-09-29")]).length === 0, "annat namn → ingen dubblett");
  ok(findDuplicates(target, [c("Engelska", "2026-09-29")]).length === 0, "en ANNAN lärares planering räknas inte");
  ok(findDuplicates(target, [c("no – växter", "2026-10-01")]).length === 1, "planering utan ownerUid räknas som min");
  const many = [c("Bråk intro", "2026-09-29"), c("Nytt", "2026-09-29"), c("NO – Växter", "2026-10-01")];
  ok(findDuplicates(target, many).length === 2, "flera på en gång: antalet dubbletter räknas");
  ok(findDuplicates([], many).length === 0 && findDuplicates(undefined, many).length === 0, "tom målklass → inga dubbletter");
}

// --- presentedPlanOf (flyttad till data/plans.js) -----------------------------
{
  const now = new Date(2026, 8, 29, 10, 30).getTime();
  const plans = [
    { id: "a", date: "2026-09-29", start: "08:00" },
    { id: "b", date: "2026-09-29", start: "10:00" },
    { id: "c", date: "2026-09-29", start: "13:00" },
  ];
  ok(presentedPlanOf(plans, null, now)?.id === "b", "förval: den som senast började");
  ok(presentedPlanOf(plans, { value: { presentedPlanId: "c" } }, now)?.id === "c", "valt id vinner");
  ok(presentedPlanOf(plans, { value: { presentedPlanId: "borta" } }, now) === null, "borttagen → tomläge");
  ok(presentedPlanOf(plans, { value: { presentedPlanId: null } }, now) === null, "null → tomläge");
}

console.log(`\n${passed} OK, ${failed} fel`);
if (failed > 0) process.exit(1);
