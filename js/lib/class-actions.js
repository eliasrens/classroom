/**
 * KLASSÅTGÄRDER — delad logg mellan lärarna (issue #34).
 *
 * "Testade att låta dem arbeta i par i stället för enskilt — betydligt
 * lugnare. → Bättre". En klassåtgärd gäller KLASSEN, aldrig en enskild
 * elev, och delas därför i molnet mellan alla inloggade lärare:
 *
 *   classes/{cid}/classActions/{id}        — själva åtgärden
 *   classes/{cid}/classActionReplies/{id}  — "Testade också"-svar
 *                                            (actionId pekar på åtgärden)
 *
 * Svaren ligger i en PLATT samling bredvid (inte en subkollektion per
 * åtgärd): en lyssnare per klass i stället för en per åtgärd, och
 * datalagrets paths förblir två nivåer djupa. Se DATAMODELL.md.
 *
 * Bara upphovspersonen får ändra/ta bort sin post (firestore.rules).
 *
 * NAMNSPÄRR: texten delas med alla lärare, så innan något sparas prövas
 * den mot den här datorns LOKALA elevlistor (findStudentNames). Innehåller
 * texten ett elevnamn sparas den inte. Spärren kan bara finnas i klienten
 * — namnen finns aldrig i molnet, så reglerna kan inte känna till dem.
 *
 * Allt här är rena funktioner (inga DOM- eller nätanrop) — testas i
 * docs/test-class-actions.mjs.
 */

export const classActionsPath = (cid) => `classes/${cid}/classActions`;
export const classActionRepliesPath = (cid) => `classes/${cid}/classActionReplies`;

// Samma gränser som firestore.rules — ändras de, ändra båda.
export const TEXT_MAX = 500;
export const REPLY_MAX = 300;
export const CATEGORY_MAX = 40;

/** Utfall — ikonerna (js/lib/icons.js) ersätter spec:ens 🟢⚪🔴❔. */
export const OUTCOMES = [
  { id: "better", label: "Bättre", icon: "trend-up" },
  { id: "same", label: "Ingen skillnad", icon: "equal" },
  { id: "worse", label: "Sämre", icon: "trend-down" },
  { id: "unsure", label: "Osäkert", icon: "help" },
];
export const OUTCOME_IDS = OUTCOMES.map((o) => o.id);
export const outcomeById = (id) => OUTCOMES.find((o) => o.id === id) ?? OUTCOMES[3];

/** Förvalda kategorier. Läraren kan också skriva en egen (fritext). */
export const CATEGORIES = [
  { id: "arbetssatt", label: "Arbetssätt", hint: "par, grupp, enskilt" },
  { id: "placering", label: "Placering", hint: "" },
  { id: "struktur", label: "Struktur", hint: "tydliga instruktioner, bildstöd" },
  { id: "rorelse", label: "Rörelse & pauser", hint: "" },
  { id: "ljud", label: "Ljud", hint: "" },
  { id: "ovrigt", label: "Övrigt", hint: "" },
];

/** Visningsnamn för en kategori: förvald → dess etikett, egen → texten. */
export function categoryLabel(category) {
  if (!category) return "";
  return CATEGORIES.find((c) => c.id === category)?.label ?? String(category);
}

/** Filtervärde för en kategori (förvalda: id, egna: skiftlägesokänsligt). */
export const categoryKey = (category) =>
  !category ? "" : CATEGORIES.some((c) => c.id === category) ? category : `egen:${String(category).toLocaleLowerCase("sv")}`;

/** De kategorier som faktiskt används (för filtret), förvalda först. */
export function categoryOptions(actions) {
  const used = new Map();
  for (const a of actions) {
    if (!a.category) continue;
    const key = categoryKey(a.category);
    if (!used.has(key)) used.set(key, categoryLabel(a.category));
  }
  const preset = CATEGORIES.filter((c) => used.has(c.id)).map((c) => ({ value: c.id, name: c.label }));
  const custom = [...used]
    .filter(([k]) => k.startsWith("egen:"))
    .sort((a, b) => a[1].localeCompare(b[1], "sv"))
    .map(([value, name]) => ({ value, name }));
  return [...preset, ...custom];
}

// ---- Ögonblicksbild av lektionen (samma form som noteStats/sessions) ----

const LESSON_KEYS = ["date", "start", "end", "subjectId", "title"];

/** Bara de kända lektionsfälten (reglerna tillåter inga andra), eller null. */
export function cleanLesson(lesson) {
  if (!lesson || typeof lesson !== "object" || !lesson.date) return null;
  const out = {};
  for (const k of LESSON_KEYS) out[k] = lesson[k] == null ? (k === "title" ? "" : null) : String(lesson[k]);
  return out;
}

/** Identitet för "samma lektion": dag + start + ämne (titeln kan skilja
 *  mellan lärarnas egna planeringar och räknas inte). */
export const lessonKey = (l) => (l?.date ? `${l.date}|${l.start ?? ""}|${l.subjectId ?? ""}` : null);

// ---- Validering (speglar firestore.rules) ----

/**
 * Normalisera formulärets värden till ett dokument som reglerna godtar.
 * Kastar Error med en läsbar text om något saknas.
 */
export function buildActionDoc({ text, outcome, category, lesson }) {
  const t = String(text ?? "").trim();
  if (!t) throw new Error("Skriv vad ni testade och hur det gick.");
  if (t.length > TEXT_MAX) throw new Error(`Texten får vara högst ${TEXT_MAX} tecken.`);
  if (!OUTCOME_IDS.includes(outcome)) throw new Error("Välj hur det gick.");
  const c = String(category ?? "").trim();
  if (c.length > CATEGORY_MAX) throw new Error(`Kategorin får vara högst ${CATEGORY_MAX} tecken.`);
  return { text: t, outcome, category: c || null, lesson: cleanLesson(lesson) };
}

export function buildReplyDoc({ actionId, text, outcome }) {
  const t = String(text ?? "").trim();
  if (!actionId) throw new Error("Svaret saknar åtgärd.");
  if (t.length > REPLY_MAX) throw new Error(`Svaret får vara högst ${REPLY_MAX} tecken.`);
  if (!OUTCOME_IDS.includes(outcome)) throw new Error("Välj hur det gick.");
  return { actionId: String(actionId), text: t, outcome };
}

// ---- Namnspärren ----

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Elevnamn som förekommer i texten — skiftlägesokänsligt och som HELA ord
 * (även med genitiv-s: "Omars grupp"). Unicode-medvetet, så å/ä/ö och
 * bindestreck i namn fungerar ("Anna-Lena").
 *
 * names: förnamn ur den lokala elevlistan (alla klasser på datorn).
 * → [{ name, index, length }] sorterat på position (tomt = ok att spara).
 */
export function findStudentNames(text, names) {
  const src = String(text ?? "").normalize("NFC");
  if (!src.trim()) return [];
  const uniq = [...new Set(
    names.map((n) => String(n ?? "").normalize("NFC").trim()).filter((n) => [...n].length >= 2),
  )].sort((a, b) => b.length - a.length); // längsta först: "Anna-Lena" före "Anna"
  const hits = [];
  const taken = [];
  for (const name of uniq) {
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(name)}s?(?![\\p{L}\\p{N}])`, "giu");
    for (const m of src.matchAll(re)) {
      const start = m.index;
      const end = start + m[0].length;
      if (taken.some(([s, e]) => start < e && end > s)) continue;
      taken.push([start, end]);
      hits.push({ name, index: start, length: m[0].length });
    }
  }
  return hits.sort((a, b) => a.index - b.index);
}

/** Texten som segment för markering: [{ text, hit }] (hit = elevnamn). */
export function highlightSegments(text, hits) {
  const src = String(text ?? "").normalize("NFC");
  const out = [];
  let at = 0;
  for (const h of hits) {
    if (h.index > at) out.push({ text: src.slice(at, h.index), hit: false });
    out.push({ text: src.slice(h.index, h.index + h.length), hit: true });
    at = h.index + h.length;
  }
  if (at < src.length) out.push({ text: src.slice(at), hit: false });
  return out;
}

// ---- Koppling till klasstatistiken (noteStats + sessions, issue #32) ----

const isNeg = (s) => (s.kind ?? "typ") === "typ" && !s.positive;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Lektionens tidpunkt (för före/efter): datum + start, annars createdAt. */
export function lessonTime(lesson, fallback) {
  if (!lesson?.date) return fallback ?? 0;
  const t = new Date(`${lesson.date}T${/^\d{1,2}:\d{2}$/.test(lesson.start ?? "") ? lesson.start.padStart(5, "0") : "12:00"}:00`).getTime();
  return Number.isFinite(t) ? t : fallback ?? 0;
}

/**
 * Klassens lektioner ur de anonyma strecken och trafikljuspassen, grupperade
 * på lessonKey: Map(key → { lesson, time, stats: [], passes: [] }).
 */
export function lessonIndex(noteStats, sessions) {
  const idx = new Map();
  const add = (lesson, fallbackTs) => {
    const key = lessonKey(lesson);
    if (!key) return null;
    if (!idx.has(key)) idx.set(key, { lesson, time: lessonTime(lesson, fallbackTs), stats: [], passes: [] });
    return idx.get(key);
  };
  for (const s of noteStats) add(s.lesson, s.createdAt)?.stats.push(s);
  for (const p of sessions) {
    if (p.type !== "trafikljus" || !p.result) continue;
    add(p.lesson, p.startedAt ?? p.createdAt)?.passes.push(p);
  }
  return idx;
}

/** Antal per negativ typ i en lektion: [{ typeId, n }], störst först. */
export function negByType(stats) {
  const m = new Map();
  for (const s of stats) if (isNeg(s)) m.set(s.typeId ?? "annat", (m.get(s.typeId ?? "annat") ?? 0) + 1);
  return [...m].map(([typeId, n]) => ({ typeId, n })).sort((a, b) => b.n - a.n);
}

const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/**
 * Statistiken vid åtgärdens lektion + snitt för ämnet + före/efter.
 * → null om åtgärden saknar lektion, annars
 *   { neg, byType, positive, passes, subjectAvg, subjectLessons,
 *     before: { avg, lessons }, after: { avg, lessons } | null }
 * Före/efter: samma ämne, 7 dagar före resp. efter lektionen (lektionen
 * själv räknas inte). Bara lektioner som syns i statistiken (minst ett
 * streck eller ett trafikljuspass) räknas — det står i gränssnittet.
 */
export function lessonStatsFor(action, index, { windowDays = 7 } = {}) {
  const lesson = action?.lesson;
  const key = lessonKey(lesson);
  if (!key) return null;
  const here = index.get(key) ?? { stats: [], passes: [], time: lessonTime(lesson, action.createdAt) };
  const negOf = (g) => g.stats.filter(isNeg).length;
  const sameSubject = lesson.subjectId
    ? [...index.values()].filter((g) => g.lesson.subjectId === lesson.subjectId)
    : [];
  const t = here.time;
  const win = windowDays * DAY_MS;
  const inRange = (from, to) => sameSubject.filter((g) => lessonKey(g.lesson) !== key && g.time >= from && g.time < to);
  const before = inRange(t - win, t);
  const after = inRange(t + 1, t + win + 1);
  return {
    neg: negOf(here),
    byType: negByType(here.stats),
    positive: here.stats.filter((s) => s.positive).length,
    passes: [...here.passes].sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0)),
    subjectAvg: sameSubject.length ? avg(sameSubject.map(negOf)) : null,
    subjectLessons: sameSubject.length,
    before: { avg: avg(before.map(negOf)), lessons: before.length },
    after: { avg: avg(after.map(negOf)), lessons: after.length },
  };
}

// ---- Lektionsval i dialogen ----

/**
 * Lektioner att koppla åtgärden till: pågående först, sedan lärarens egna
 * planeringar och lektioner ur klasstatistiken de senaste `days` dagarna
 * (nyast först, unika på lessonKey).
 */
export function lessonChoices({ current = null, plans = [], noteStats = [], sessions = [], now, days = 14, max = 15 }) {
  const out = new Map();
  const push = (l) => {
    const clean = cleanLesson(l);
    const key = lessonKey(clean);
    if (key && !out.has(key)) out.set(key, clean);
  };
  if (current) push(current);
  const from = now - days * DAY_MS;
  const cands = [];
  for (const p of plans) {
    const blocks = p.blocks ?? [{ start: p.start, end: p.end, subjectId: p.subjectId, title: p.name }];
    for (const b of blocks) {
      const l = { date: p.date, start: b.start ?? null, end: b.end ?? null, subjectId: b.subjectId ?? null, title: b.title ?? "" };
      cands.push(l);
    }
  }
  for (const s of noteStats) if (s.lesson) cands.push(s.lesson);
  for (const s of sessions) if (s.lesson) cands.push(s.lesson);
  cands
    .map((l) => ({ l, t: lessonTime(l, 0) }))
    .filter(({ l, t }) => l?.date && t >= from && t <= now)
    .sort((a, b) => b.t - a.t)
    .forEach(({ l }) => push(l));
  return [...out.values()].slice(0, max);
}
