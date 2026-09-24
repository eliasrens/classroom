/**
 * ELEVRAPPORTER — ren datalogik (issue #33). Ingen DOM, inget nätverk.
 *
 *  - PERIODER: förra veckan (standard), denna vecka, senaste 4 veckorna,
 *    hela terminen eller egna datum. "Nu" = serverNow() (js/lib/clock.js).
 *  - NYTTOLAST: det som krypteras i en .klassrum-fil (se
 *    js/lib/report-crypto.js). Innehåller allt som behövs för att slå
 *    samman flera lärares filer: formatversion, klass, exporterande lärare,
 *    exportdatum, period och per elev det lokala namnet, tag, det lokala
 *    elev-id:t och noteringarna med sina UNIKA id:n.
 *  - MATCHNING: datorerna har inga gemensamma elev-id:n (namnen finns bara
 *    lokalt, #32), så elever föreslås på klass + namn (skiftlägesokänsligt,
 *    trimmat, tag som särskiljare). Läraren bekräftar alltid.
 *  - SAMMANSLAGNING: samma notering räknas en gång (notisens id + lärarens
 *    uid), oavsett hur många filer den finns i.
 *  - ANALYS: per elev och för klassen — återanvänder mönsterhjälparna ur
 *    patterns.js/shared.js (veckodag, tid på dagen, moment i lektionen).
 *  - PÅMINNELSER: måndagsbannern och påminnelsen före lokal gallring.
 *
 * Den dekrypterade/sammanslagna datan hålls BARA i minnet av anroparen —
 * ingenting här skriver någonstans.
 */

import { NOTE_TYPES, noteTypeById, momentOf, weekdayOf, hourOf, WEEKDAYS, MOMENT_BUCKETS } from "./shared.js";
import { tally } from "./patterns.js";
import { startOfWeek, addWeeks, weekKey, isoWeek, weekLabel, weekRangeLabel, weekStartFromKey } from "../../lib/week.js";
import { serverNow } from "../../lib/clock.js";

/** Nyttolastens format. Höj vid inkompatibla ändringar och lägg en uppgradering i upgradePayload. */
export const REPORT_FORMAT = "klassrum-rapport";
export const REPORT_FORMAT_VERSION = 1;

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;

// ---- Perioder ----

export const PERIOD_PRESETS = [
  { id: "lastWeek", name: "Förra veckan" },
  { id: "thisWeek", name: "Denna vecka" },
  { id: "last4", name: "Senaste 4 veckorna" },
  { id: "term", name: "Hela terminen" },
  { id: "custom", name: "Egna datum" },
];

const pad2 = (n) => String(n).padStart(2, "0");
export const isoDate = (ms) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};
const dateStart = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? ""));
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime() : null;
};
const nextDay = (ms) => { const d = new Date(ms); d.setDate(d.getDate() + 1); return d.getTime(); };

/** Terminsstart: vårterminen från 1 jan (t.o.m. juli), hösttterminen från 1 aug. */
export function termStart(now = serverNow()) {
  const d = new Date(now);
  return new Date(d.getFullYear(), d.getMonth() >= 7 ? 7 : 0, 1).getTime();
}

/**
 * Period { id, from, to, label } — from inklusive, to exklusive (epoch ms).
 * custom: { from: "YYYY-MM-DD", to: "YYYY-MM-DD" } (båda dagarna inklusive).
 */
export function periodFor(id, now = serverNow(), custom = {}) {
  const ws = startOfWeek(now);
  let from;
  let to;
  switch (id) {
    case "thisWeek": from = ws; to = addWeeks(ws, 1); break;
    case "last4": from = addWeeks(ws, -3); to = addWeeks(ws, 1); break;
    case "term": from = termStart(now); to = addWeeks(ws, 1); break;
    case "custom": {
      const a = dateStart(custom.from);
      const b = dateStart(custom.to);
      if (a != null && b != null) {
        from = Math.min(a, b);
        to = nextDay(Math.max(a, b));
        break;
      }
      id = "lastWeek";
    }
    // fallthrough — ogiltiga egna datum → förra veckan
    default: id = "lastWeek"; from = addWeeks(ws, -1); to = ws;
  }
  return { id, from, to, label: periodLabel({ from, to }, now) };
}

const fmtDay = (ms, withYear) => new Date(ms).toLocaleDateString("sv-SE",
  withYear ? { day: "numeric", month: "short", year: "numeric" } : { day: "numeric", month: "short" }).replace(/\.(?=\s|$)/g, "");

/** "v.38 (14–20 sep)", "v.36–39 (31 aug–27 sep)" eller "1 aug–24 sep 2026". */
export function periodLabel({ from, to }, now = serverNow()) {
  const wholeWeeks = from === startOfWeek(from) && to === startOfWeek(to) && to > from;
  if (wholeWeeks) {
    const n = Math.round((to - from) / WEEK_MS);
    if (n === 1) return `${weekLabel(from, now)} (${weekRangeLabel(from)})`;
    const a = isoWeek(from);
    const b = isoWeek(to - 1);
    const range = `${fmtDay(from)}–${fmtDay(to - 1)}`;
    return a.year === b.year
      ? `v.${a.week}–${b.week} (${range})`
      : `v.${a.week} ${a.year}–v.${b.week} ${b.year} (${range})`;
  }
  const sameYear = new Date(from).getFullYear() === new Date(to - 1).getFullYear();
  return `${fmtDay(from, !sameYear)}–${fmtDay(to - 1, true)}`;
}

/** Periodens del i filnamnet: "v39-2026" för en vecka, annars "2026-08-01_2026-09-24". */
export function periodFileTag({ from, to }) {
  if (from === startOfWeek(from) && to === addWeeks(from, 1)) {
    const { year, week } = isoWeek(from);
    return `v${pad2(week)}-${year}`;
  }
  return `${isoDate(from)}_${isoDate(to - 1)}`;
}

/** Säkert filnamnsled: "Åsa Ek" → "Asa-Ek". */
export function fileSlug(s) {
  return String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "x";
}

/**
 * Filnamn UTAN elevnamn: klassrum-4A-v39-2026-catalin.klassrum.
 * Lärarens namn är med — det underlättar sammanslagning.
 */
export function reportFileName({ className, period, teacherName, merged = false }) {
  const parts = ["klassrum", fileSlug(className), periodFileTag(period), fileSlug(teacherName || "larare").toLowerCase()];
  if (merged) parts.push("sammanstallning");
  return `${parts.join("-")}.klassrum`;
}

/** Svensk genitiv: "Catalin" → "Catalins", "Elias" → "Elias". */
export const genitive = (name) => (/[sxz]$/i.test(String(name ?? "")) ? String(name) : `${name}s`);

// ---- Noteringar → exportform ----

const inPeriod = (ts, period) => typeof ts === "number" && ts >= period.from && ts < period.to;

export function kindName(n) {
  if (n.kind === "typ") return n.typeName || noteTypeById(n.typeId)?.name || "Notering";
  if (n.kind === "insats") return "Insats";
  return "Anteckning"; // uppföljning visas som egen markering bredvid
}

/** Noteringen som den står i filen — med etikett och ämnesnamn inbakade (mottagaren saknar våra inställningar). */
export function exportNote(n, { labels = [], subjects = [], teacher }) {
  const label = labels.find((l) => l.id === n.labelId) ?? null;
  const lesson = n.lesson ? {
    date: n.lesson.date ?? null,
    start: n.lesson.start ?? null,
    end: n.lesson.end ?? null,
    subjectId: n.lesson.subjectId ?? null,
    subjectName: n.lesson.subjectName ?? subjects.find((s) => s.id === n.lesson.subjectId)?.name ?? null,
    title: n.lesson.title ?? "",
  } : null;
  return {
    id: String(n.id),
    createdAt: n.createdAt ?? n.updatedAt ?? 0,
    kind: n.kind ?? "typ",
    typeId: n.typeId ?? null,
    typeName: n.kind === "typ" ? (noteTypeById(n.typeId)?.name ?? null) : null,
    positive: Boolean(n.positive),
    text: String(n.text ?? ""),
    followUp: Boolean(n.followUp),
    helped: n.kind === "insats" ? (n.helped ?? null) : null,
    label: label ? { name: String(label.name ?? ""), color: String(label.color ?? "") } : null,
    lesson,
    // Vilken lärare: på den här datorn skapade noteringar saknar sällan
    // attribution — men gamla noteringar kan göra det; då räknas de till
    // den exporterande läraren (behövs för dubblettnyckeln).
    createdBy: n.createdBy || teacher.uid,
    createdByName: n.createdByName || teacher.name || "okänd lärare",
  };
}

/**
 * Bygg nyttolasten för en rapport ur den här datorns lokala data.
 *   cls        { id, name }
 *   teacher    { uid, name }
 *   period     { from, to, label }
 *   students   lokala elevdokument
 *   notes      lokala noteringar
 *   praiseDocs [{ weekOf, praise: [...] }] — Bra jobbat (listan + veckoarkivet)
 *   labels     lärarens etiketter (settings/elevlista → labels)
 *   subjects   ämnen (inbyggda + klassens egna)
 *   studentIds null = hela klassen, annars de valda eleverna
 */
export function buildReportPayload({
  cls, teacher, period, students = [], notes = [], praiseDocs = [], labels = [], subjects = [],
  studentIds = null, now = serverNow(),
}) {
  const wanted = studentIds ? new Set(studentIds) : null;
  const periodNotes = notes.filter((n) => n.studentId && inPeriod(n.createdAt ?? n.updatedAt, period));
  const withNotes = new Set(periodNotes.map((n) => n.studentId));
  // Hela klassen = aktiva elever + arkiverade som har noteringar i perioden.
  const chosen = students
    .filter((s) => (wanted ? wanted.has(s.id) : (s.active !== false || withNotes.has(s.id))))
    .sort((a, b) => String(a.firstName).localeCompare(String(b.firstName), "sv"));

  // Bra jobbat: veckor som överlappar perioden.
  const praiseByStudent = new Map();
  for (const doc of praiseDocs) {
    const ws = weekStartFromKey(doc?.weekOf);
    if (ws == null || ws >= period.to || addWeeks(ws, 1) <= period.from) continue;
    for (const p of doc.praise ?? []) {
      if (p?.kind !== "student" || !p.studentId) continue;
      const list = praiseByStudent.get(p.studentId) ?? [];
      if (!list.some((x) => x.weekOf === doc.weekOf)) list.push({ weekOf: doc.weekOf, by: teacher.uid, byName: teacher.name });
      praiseByStudent.set(p.studentId, list);
    }
  }

  const ctx = { labels, subjects, teacher };
  const payloadStudents = chosen.map((s) => ({
    localId: String(s.id),
    name: String(s.firstName ?? ""),
    tag: s.tag ? String(s.tag) : null,
    notes: periodNotes
      .filter((n) => n.studentId === s.id)
      .map((n) => exportNote(n, ctx))
      .sort((a, b) => a.createdAt - b.createdAt),
    praise: (praiseByStudent.get(s.id) ?? []).sort((a, b) => a.weekOf.localeCompare(b.weekOf)),
  }));

  const kind = wanted && chosen.length === 1 ? "student" : "class";
  const exportedAt = now;
  const source = {
    teacherUid: teacher.uid, teacherName: teacher.name, className: cls.name,
    exportedAt, period: { from: period.from, to: period.to, label: period.label }, kind,
  };
  return {
    format: REPORT_FORMAT,
    formatVersion: REPORT_FORMAT_VERSION,
    kind,
    className: cls.name,
    classId: cls.id ?? null,
    exporter: { uid: teacher.uid, name: teacher.name },
    exportedAt,
    period: { from: period.from, to: period.to, label: period.label },
    sources: [source],
    students: payloadStudents,
  };
}

/** Klartext-META för filhuvudet — aldrig elevnamn eller notistext. */
export function reportMeta(payload) {
  return {
    app: "Klassrumsverktyget",
    kind: payload.kind,
    className: payload.className,
    teacherName: payload.exporter?.name ?? null,
    teachers: [...new Set((payload.sources ?? []).map((s) => s.teacherName).filter(Boolean))],
    periodLabel: payload.period?.label ?? "",
    exportedAt: payload.exportedAt,
    studentCount: payload.students?.length ?? 0,
    formatVersion: payload.formatVersion,
  };
}

/**
 * Validera + uppgradera en dekrypterad nyttolast till aktuell form.
 * Äldre versioner uppgraderas här; nyare ger ett begripligt fel.
 * → { ok: true, payload } | { ok: false, code: "newer-version" | "corrupt" }
 */
export function upgradePayload(raw) {
  if (!raw || typeof raw !== "object" || raw.format !== REPORT_FORMAT || !Number.isInteger(raw.formatVersion)) {
    return { ok: false, code: "corrupt" };
  }
  if (raw.formatVersion > REPORT_FORMAT_VERSION) return { ok: false, code: "newer-version" };
  const p = structuredCloneSafe(raw);
  // (formatVersion 1 är den första — framtida uppgraderingar läggs här, t.ex.
  //  if (p.formatVersion === 1) { …; p.formatVersion = 2; })
  if (!Array.isArray(p.students) || !p.exporter || !p.period) return { ok: false, code: "corrupt" };
  if (!Array.isArray(p.sources) || p.sources.length === 0) {
    p.sources = [{ teacherUid: p.exporter.uid, teacherName: p.exporter.name, className: p.className,
      exportedAt: p.exportedAt, period: p.period, kind: p.kind }];
  }
  for (const s of p.students) {
    s.notes = Array.isArray(s.notes) ? s.notes : [];
    s.praise = Array.isArray(s.praise) ? s.praise : [];
    for (const n of s.notes) {
      n.createdBy = n.createdBy || p.exporter.uid;
      n.createdByName = n.createdByName || p.exporter.name || "okänd lärare";
    }
  }
  return { ok: true, payload: p };
}

const structuredCloneSafe = (v) => JSON.parse(JSON.stringify(v));

// ---- Elevmatchning ----

export const normName = (s) => String(s ?? "").normalize("NFC").trim().replace(/\s+/g, " ").toLocaleLowerCase("sv");
const normTag = (t) => String(t ?? "").normalize("NFC").trim().toLocaleLowerCase("sv");

/**
 * Föreslå vilken lokal elev en elev i en fil motsvarar.
 *   remote  { localId, name, tag }
 *   locals  lokala elever [{ id, firstName, tag, active }]
 *   saved   sparade namnpar [{ teacherUid, name, tag, localId }]
 * → { localId: string|null, reason: "saved"|"name"|"name+tag"|"ambiguous"|"none" }
 */
export function suggestMatch(remote, locals, { saved = [], teacherUid = null } = {}) {
  const rn = normName(remote.name);
  const rt = normTag(remote.tag);
  const pair = saved.find((p) => p.teacherUid === teacherUid && normName(p.name) === rn && normTag(p.tag) === rt);
  if (pair && locals.some((s) => s.id === pair.localId)) return { localId: pair.localId, reason: "saved" };
  const byName = locals.filter((s) => normName(s.firstName) === rn);
  if (byName.length === 0) return { localId: null, reason: "none" };
  if (byName.length === 1) {
    const s = byName[0];
    // Båda har en särskiljare och de skiljer sig → inte samma elev.
    if (rt && normTag(s.tag) && normTag(s.tag) !== rt) return { localId: null, reason: "none" };
    return { localId: s.id, reason: rt && normTag(s.tag) === rt ? "name+tag" : "name" };
  }
  const byTag = byName.filter((s) => normTag(s.tag) === rt);
  if (byTag.length === 1) return { localId: byTag[0].id, reason: rt ? "name+tag" : "name" };
  // Flera med samma namn och ingen särskiljare avgör — prova samma elev-id (före #32 delades id:n).
  const byId = byName.filter((s) => s.id === remote.localId);
  if (byId.length === 1) return { localId: byId[0].id, reason: "name" };
  return { localId: null, reason: "ambiguous" };
}

/** Spara bekräftade namnpar (bara namn ↔ lokalt id, ingen notisdata). */
export function updateSavedPairs(saved, teacherUid, rows) {
  const out = (saved ?? []).filter((p) => !(p.teacherUid === teacherUid
    && rows.some((r) => normName(r.name) === normName(p.name) && normTag(r.tag) === normTag(p.tag))));
  for (const r of rows) {
    if (r.localId) out.push({ teacherUid, name: String(r.name ?? ""), tag: r.tag ?? null, localId: r.localId });
  }
  return out.slice(-500);
}

// ---- Sammanslagning ----

/** Färger per lärare (dämpade, går att skilja åt även i gråskala via namn). */
export const TEACHER_COLORS = ["#5577b5", "#b05f7d", "#4e8f72", "#b88540", "#7a63a8", "#4f93a8", "#b3564e", "#937a45"];

export const noteKey = (n) => `${n.createdBy}:${n.id}`;

/**
 * Slå samman en eller flera källor till en gemensam sammanställning.
 *   sources: [{ key, payload, targets: { [remoteLocalId]: targetKey } }]
 *     targetKey "local:<id>" = den här datorns elev (namnet tas härifrån)
 *     annat/saknas = hålls isär (eleven visas separat, "<namn> (Catalins fil)")
 *   locals: den här datorns elever (namn för "local:"-mål)
 *
 * Samma notering (notisens id + lärarens uid) räknas bara EN gång, även om
 * den finns i flera filer eller i en fil och i den egna datan.
 */
export function mergeReports(sources, { locals = [] } = {}) {
  const students = new Map(); // targetKey → student
  const seen = new Map();     // noteKey → targetKey
  const praiseSeen = new Set();
  const teachers = new Map(); // uid → { uid, name }
  let from = Infinity;
  let to = -Infinity;
  const sourceList = [];

  for (const src of sources) {
    const p = src.payload;
    from = Math.min(from, p.period.from);
    to = Math.max(to, p.period.to);
    for (const s of p.sources ?? []) {
      if (!sourceList.some((x) => x.teacherUid === s.teacherUid && x.exportedAt === s.exportedAt && x.period?.from === s.period?.from)) {
        sourceList.push({ ...s });
      }
    }
    for (const rs of p.students) {
      const target = src.targets?.[rs.localId] ?? `sep:${src.key}:${rs.localId}`;
      let st = students.get(target);
      if (!st) {
        const local = target.startsWith("local:") ? locals.find((l) => `local:${l.id}` === target) : null;
        st = {
          key: target,
          localId: local ? local.id : null,
          name: local ? local.firstName : rs.name,
          tag: local ? (local.tag ?? null) : rs.tag,
          fromFile: local ? null : (p.exporter?.name ?? null),
          aliases: [],
          notes: [],
          praise: [],
        };
        students.set(target, st);
      }
      const alias = `${p.exporter?.name ?? "?"}: ${rs.name}${rs.tag ? ` ${rs.tag}` : ""}`;
      if (!st.aliases.includes(alias)) st.aliases.push(alias);
      for (const n of rs.notes) {
        const k = noteKey(n);
        if (seen.has(k)) continue;
        seen.set(k, target);
        st.notes.push(n);
        if (!teachers.has(n.createdBy)) teachers.set(n.createdBy, { uid: n.createdBy, name: n.createdByName });
      }
      for (const pr of rs.praise ?? []) {
        const k = `${target}|${pr.by}|${pr.weekOf}`;
        if (praiseSeen.has(k)) continue;
        praiseSeen.add(k);
        st.praise.push(pr);
        if (pr.by && !teachers.has(pr.by)) teachers.set(pr.by, { uid: pr.by, name: pr.byName });
      }
    }
  }

  const list = [...students.values()];
  for (const st of list) {
    st.notes.sort((a, b) => a.createdAt - b.createdAt);
    st.praise.sort((a, b) => a.weekOf.localeCompare(b.weekOf));
  }
  list.sort((a, b) => String(a.name).localeCompare(String(b.name), "sv") || String(a.fromFile ?? "").localeCompare(String(b.fromFile ?? ""), "sv"));
  const teacherList = [...teachers.values()].sort((a, b) => String(a.name).localeCompare(String(b.name), "sv"))
    .map((t, i) => ({ ...t, color: TEACHER_COLORS[i % TEACHER_COLORS.length] }));
  return {
    students: list,
    teachers: teacherList,
    period: { from: Number.isFinite(from) ? from : 0, to: Number.isFinite(to) ? to : 0 },
    sources: sourceList,
  };
}

/** Sammanställningen som ny nyttolast (samma format; källfilerna och lärarna framgår). */
export function mergedToPayload(merged, { className, classId = null, teacher, now = serverNow() }) {
  const period = { from: merged.period.from, to: merged.period.to, label: periodLabel(merged.period, now) };
  return {
    format: REPORT_FORMAT,
    formatVersion: REPORT_FORMAT_VERSION,
    kind: "merged",
    className,
    classId,
    exporter: { uid: teacher.uid, name: teacher.name },
    exportedAt: now,
    period,
    // "Den här datorn" gäller bara här — i filen är det en vanlig källa.
    sources: merged.sources.map(({ thisComputer, ...src }) => src),
    students: merged.students.map((s, i) => ({
      localId: s.localId ?? `m${i + 1}`,
      name: s.name,
      tag: s.tag ?? null,
      notes: s.notes,
      praise: s.praise,
    })),
  };
}

// ---- Analys ----

export function lessonSubject(n) {
  const l = n.lesson;
  if (!l) return "Utanför lektion";
  return l.subjectName || l.title || l.subjectId || "Lektion utan ämne";
}

export function lessonName(n) {
  const l = n.lesson;
  if (!l) return "Utanför lektion";
  const subject = l.subjectName || l.subjectId || "";
  const title = l.title && l.title !== subject ? l.title : "";
  const name = [subject, title].filter(Boolean).join(" · ") || "Lektion";
  return l.start ? `${name} ${l.start}${l.end ? `–${l.end}` : ""}` : name;
}

const normText = (s) => String(s ?? "").normalize("NFC").trim().replace(/\s+/g, " ").replace(/[.!]+$/, "").toLocaleLowerCase("sv");

/** Insatser sammanräknade över lärarna: "Flytta plats: hjälpte 3 av 4 gånger". */
export function interventionSummary(notes) {
  const groups = new Map();
  for (const n of notes) {
    if (n.kind !== "insats") continue;
    const k = normText(n.text) || "(utan beskrivning)";
    const g = groups.get(k) ?? { text: String(n.text ?? "").trim() || "(utan beskrivning)", total: 0, ja: 0, delvis: 0, nej: 0, unknown: 0, teachers: [] };
    g.total++;
    if (n.helped === "ja" || n.helped === "delvis" || n.helped === "nej") g[n.helped]++;
    else g.unknown++;
    if (n.createdByName && !g.teachers.includes(n.createdByName)) g.teachers.push(n.createdByName);
    groups.set(k, g);
  }
  return [...groups.values()].sort((a, b) => b.total - a.total || a.text.localeCompare(b.text, "sv"));
}

export function interventionLine(g) {
  const extra = [g.delvis ? `delvis ${g.delvis}` : "", g.unknown ? `${g.unknown} utan svar` : ""].filter(Boolean).join(", ");
  return `hjälpte ${g.ja} av ${g.total} ${g.total === 1 ? "gång" : "gånger"}${extra ? ` (${extra})` : ""}`;
}

/**
 * Analys för en elev (eller hela klassen: skicka alla noteringar).
 * teachers: [{ uid, name, color }] ur mergeReports.
 */
export function analyzeNotes(notes, { teachers = [], period = null } = {}) {
  const typ = notes.filter((n) => n.kind === "typ");
  const neg = typ.filter((n) => !n.positive);
  const pos = notes.filter((n) => n.positive);
  const teacherName = (uid, fallback) => teachers.find((t) => t.uid === uid)?.name ?? fallback ?? "okänd lärare";

  // Typ × ämne × lärare: "Prat: 9 i Matematik (Catalin), 2 i Svenska (Elias)"
  const typeSubjectTeacher = [];
  for (const t of NOTE_TYPES) {
    const of = typ.filter((n) => (n.typeId ?? "annat") === t.id);
    if (of.length === 0) continue;
    const parts = new Map();
    for (const n of of) {
      const k = `${lessonSubject(n)}|${n.createdBy}`;
      const part = parts.get(k) ?? { subject: lessonSubject(n), teacherUid: n.createdBy, teacherName: teacherName(n.createdBy, n.createdByName), count: 0 };
      part.count++;
      parts.set(k, part);
    }
    typeSubjectTeacher.push({
      typeId: t.id, typeName: t.name, positive: Boolean(t.positive), total: of.length,
      parts: [...parts.values()].sort((a, b) => b.count - a.count || a.subject.localeCompare(b.subject, "sv")),
    });
  }

  const byTeacher = teachers.map((t) => {
    const mine = notes.filter((n) => n.createdBy === t.uid);
    return { ...t, total: mine.length, neg: mine.filter((n) => n.kind === "typ" && !n.positive).length,
      pos: mine.filter((n) => n.positive).length, insats: mine.filter((n) => n.kind === "insats").length };
  }).filter((t) => t.total > 0);

  // Vecka för vecka (om perioden spänner över flera veckor).
  const weeks = [];
  if (period && period.to - period.from > WEEK_MS) {
    for (let ws = startOfWeek(period.from); ws < period.to; ws = addWeeks(ws, 1)) {
      const of = notes.filter((n) => n.createdAt >= ws && n.createdAt < addWeeks(ws, 1));
      weeks.push({
        weekKey: weekKey(ws), label: weekLabel(ws, period.to - 1), range: weekRangeLabel(ws),
        neg: of.filter((n) => n.kind === "typ" && !n.positive).length,
        pos: of.filter((n) => n.positive).length,
        text: of.filter((n) => n.kind === "text").length,
        insats: of.filter((n) => n.kind === "insats").length,
        followUps: of.filter((n) => n.followUp).length,
      });
    }
  }

  const hourKeysOf = [...new Set(neg.map(hourOf))].sort();
  const subjectKeysOf = [...new Set(neg.map(lessonSubject))].sort((a, b) => a.localeCompare(b, "sv"));
  const lessonKeysOf = [...new Set(neg.map(lessonName))].sort((a, b) => a.localeCompare(b, "sv"));

  return {
    counts: {
      total: notes.length,
      neg: neg.length,
      pos: pos.length,
      text: notes.filter((n) => n.kind === "text").length,
      insats: notes.filter((n) => n.kind === "insats").length,
      followUps: notes.filter((n) => n.followUp).length,
    },
    byType: tally(typ, (n) => kindName(n), NOTE_TYPES.map((t) => t.name).filter((name) => typ.some((n) => kindName(n) === name))),
    typeSubjectTeacher,
    byTeacher,
    byWeekday: tally(neg, weekdayOf, WEEKDAYS.filter((d, i) => i < 5 || neg.some((n) => weekdayOf(n) === d))),
    byHour: tally(neg, hourOf, hourKeysOf),
    byMoment: tally(neg, momentOf, MOMENT_BUCKETS.filter((b) => neg.some((n) => momentOf(n) === b))),
    bySubject: tally(neg, lessonSubject, subjectKeysOf),
    byLesson: tally(neg, lessonName, lessonKeysOf),
    followUps: notes.filter((n) => n.followUp),
    interventions: interventionSummary(notes),
    positives: pos,
    weeks,
  };
}

/** Klassens sammanfattning överst: "4 elever med öppna uppföljningar". */
export function classSummary(merged) {
  const withFollowUps = merged.students.filter((s) => s.notes.some((n) => n.followUp));
  const all = merged.students.flatMap((s) => s.notes);
  return {
    students: merged.students.length,
    withNotes: merged.students.filter((s) => s.notes.length > 0).length,
    withFollowUps: withFollowUps.length,
    followUpNames: withFollowUps.map((s) => s.name),
    notes: all.length,
    followUps: all.filter((n) => n.followUp).length,
    analysis: analyzeNotes(all, { teachers: merged.teachers, period: merged.period }),
  };
}

// ---- Exportlogg och påminnelser ----
//
// Lokal logg (classes/{cid}/reports → doc "log") över vad som redan laddats
// ned: [{ at, from, to, students: null | [ids] }]. En notering räknas som
// exporterad om den föll inom en exporterad period för hela klassen eller
// för just den eleven. Loggen styr att påminnelserna inte tjatar.

export const REPORTS_LOG_ID = "log";
export const REPORTS_REMINDERS_ID = "reminders";
export const REPORTS_MATCHES_ID = "matches";
export const reportsPath = (cid) => `classes/${cid}/reports`;
const LOG_KEEP_MS = 30 * WEEK_MS; // längre än längsta lagringstiden (20 v)

/** Ny logg med en export tillagd (och gamla poster rensade). */
export function logExport(log, { period, studentIds = null, now = serverNow() }) {
  const exports = (log?.exports ?? []).filter((e) => e.to > now - LOG_KEEP_MS);
  exports.push({ at: now, from: period.from, to: Math.min(period.to, now), students: studentIds ? [...studentIds] : null });
  return { exports };
}

export function isExported(log, note) {
  const t = note.createdAt ?? 0;
  return (log?.exports ?? []).some((e) => t >= e.from && t < e.to && (!e.students || e.students.includes(note.studentId)));
}

/** Veckonycklar (unika, sorterade) som en exportperiod helt täcker — för visning. */
export function exportedWeeks(log) {
  const keys = new Set();
  for (const e of log?.exports ?? []) {
    if (e.students) continue;
    for (let ws = startOfWeek(e.from); ws < e.to; ws = addWeeks(ws, 1)) {
      if (ws >= e.from && addWeeks(ws, 1) <= e.to) keys.add(weekKey(ws));
    }
  }
  return [...keys].sort();
}

/**
 * MÅNDAGSBANNERN (veckorytmen, #29): på måndagar, om förra veckan har
 * noteringar med uppföljning som inte laddats ned. Avvisas per vecka.
 * → null | { weekKey, period, students, notes }
 */
export function mondayReminder({ notes = [], log = null, dismissed = null, now = serverNow() }) {
  if (new Date(now).getDay() !== 1) return null;
  const ws = startOfWeek(now);
  const prev = addWeeks(ws, -1);
  const key = weekKey(prev);
  if (dismissed?.monday === key) return null;
  const pending = notes.filter((n) => n.followUp && n.studentId
    && (n.createdAt ?? 0) >= prev && (n.createdAt ?? 0) < ws && !isExported(log, n));
  if (pending.length === 0) return null;
  return {
    weekKey: key,
    period: { from: prev, to: ws },
    students: new Set(pending.map((n) => n.studentId)).size,
    notes: pending.length,
  };
}

export const RETENTION_WARN_DAYS = 7;

/** Noteringar med uppföljning som ännu inte laddats ned och som gallras före `before`. */
export function followUpsAtRisk({ notes = [], weeks, log = null, before }) {
  if (!Number.isFinite(weeks) || weeks <= 0) return [];
  const cutoff = before - weeks * WEEK_MS;
  return notes.filter((n) => n.followUp && n.studentId && (n.createdAt ?? 0) > 0
    && (n.createdAt ?? 0) < cutoff && !isExported(log, n));
}

/**
 * PÅMINNELSE FÖRE GALLRING (#32): noteringar med uppföljning som inte
 * exporterats och som raderas inom RETENTION_WARN_DAYS dagar. Medan
 * uppgraderingsskyddet väntar (awaitingChoice) gallras inget — då gäller
 * påminnelsen det som raderas NÄR läraren bekräftar lagringstiden.
 * Avvisas per uppsättning veckor (nya veckor i fönstret påminner igen).
 * → null | { count, students, weekKeys, period, purgeAt, awaiting }
 */
export function retentionReminder({ notes = [], weeks, awaitingChoice = false, log = null, dismissed = null, now = serverNow() }) {
  const before = awaitingChoice ? now : now + RETENTION_WARN_DAYS * DAY_MS;
  const risk = followUpsAtRisk({ notes, weeks, log, before });
  if (risk.length === 0) return null;
  const weekKeys = [...new Set(risk.map((n) => weekKey(n.createdAt)))].sort();
  if (dismissed?.retention && weekKeys.every((k) => dismissed.retention.includes(k))) return null;
  const oldest = Math.min(...risk.map((n) => n.createdAt));
  const newest = Math.max(...risk.map((n) => n.createdAt));
  return {
    count: risk.length,
    students: new Set(risk.map((n) => n.studentId)).size,
    weekKeys,
    period: { from: startOfWeek(oldest), to: addWeeks(startOfWeek(newest), 1) },
    purgeAt: awaitingChoice ? null : Math.max(now, oldest + weeks * WEEK_MS),
    awaiting: Boolean(awaitingChoice),
  };
}
