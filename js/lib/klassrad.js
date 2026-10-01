/**
 * KLASSRÅD — ren logik (issue #125, epic #124). Ingen DOM, går att testa
 * i Node (docs/test-klassrad.mjs).
 *
 * MALLEN är lärarens egen struktur (Word-mallen) och fungerar som
 * standard. Läraren kan byta namn på punkter, ändra hjälpfrågor, lägga
 * till, ta bort, flytta och återställa. Mallen och det senaste
 * sekreterarvalet sparas PRIVAT per lärare i molnet — ALDRIG elevdata:
 *
 *   teachers/{uid}/settings/klassrad
 *     template:  { points: [punkt, …] }   — saknas → standardmallen
 *     secretary: { [classId]: "me" }       — senaste sekreterarvalet per
 *                klass; bara markören "me" (= den inloggade läraren)
 *                sparas. Valdes en elev eller fritext tas klassens
 *                förval bort — ett elevnamn når aldrig molnet.
 *
 * Ett MÖTE (ifyllt klassråd) innehåller elevnamn och elevernas
 * synpunkter → ENDAST LOKALT (js/data/local-only.js):
 *
 *   classes/{cid}/klassrad/state     { cur, presented, follow, rev }
 *   classes/{cid}/klassrad/m-<id>    möte, se normalizeMeeting()
 *
 * Ett nytt möte KOPIERAR mallens punkter. Ändras mallen senare påverkas
 * bara nya möten — ett gammalt protokoll ändras aldrig.
 *
 * Punkt: { id, title, prompts: [text], notesLabel, icon, numbered, role }
 *   role  "previous" — här visas rutan "Från förra klassrådet"
 *         "council"  — "Till elevrådet": följs upp nästa gång
 *         "followup" — "Till nästa klassråd": följs upp nästa gång
 *         null       — vanlig punkt
 * I ett möte har varje punkt dessutom `notes` (text, en rad per punkt i
 * punktlistan på elevskärmen och i utskriften).
 */

import { isoWeek } from "./week.js";

export const KLASSRAD_EVENT = "klassrad:state";
export const KLASSRAD_SETTINGS_DOC = "klassrad";
export const STATE_ID = "state";
export const SAVE_DEBOUNCE_MS = 400;

export const MAX_POINTS = 20;
export const MAX_PROMPTS = 6;
export const MAX_TITLE = 80;
export const MAX_PROMPT = 200;
export const MAX_LABEL = 80;
export const MAX_NAME = 60;
export const MAX_NOTES = 4000;

/** Lokal samling för klassens klassråd (ENDAST LOKAL, js/data/local-only.js). */
export const klassradPath = (cid) => `classes/${cid}/klassrad`;
/** Lärarens privata inställningar (molnet) — dokumentet KLASSRAD_SETTINGS_DOC. */
export const klassradSettingsPath = (uid) => `teachers/${uid}/settings`;

export const DEFAULT_NOTES_LABEL = "Anteckningar";
/** Ikoner som en punkt kan ha (js/lib/icons.js). Mallredigeringen bläddrar bland dem. */
export const POINT_ICONS = ["hand", "back", "smile", "book", "ball", "bulb", "school", "pin", "chat", "users", "star", "flag", "calendar"];
const ROLES = new Set(["previous", "council", "followup"]);
/** Roller vars anteckningar följs upp på nästa klassråd, i visningsordning. */
const FOLLOW_ROLES = ["followup", "council"];

/** Lärarens egen mall — standardinnehållet, exakt som Word-mallen (epic #124). */
export const DEFAULT_POINTS = Object.freeze([
  { id: "start", title: "Vi startar", prompts: ["Ordföranden öppnar klassrådet."], icon: "hand" },
  { id: "previous", title: "Förra klassrådet", prompts: ["Vad bestämde vi sist? Har det blivit gjort?"], icon: "back", role: "previous" },
  { id: "class", title: "Så här har vi det i klassen", prompts: ["Vad fungerar bra?", "Är det något vi behöver förbättra?"], icon: "smile" },
  { id: "lessons", title: "Lektioner och lärande", prompts: ["Hur fungerar lektionerna och arbetsron?", "Vad kan vi göra bättre tillsammans?"], icon: "book" },
  { id: "breaks", title: "Raster och trygghet", prompts: ["Hur fungerar rasterna?", "Känner sig alla trygga och delaktiga?"], icon: "ball" },
  { id: "ideas", title: "Elevernas frågor och förslag", prompts: ["Vilka frågor, idéer eller önskemål vill klassen ta upp?"], icon: "bulb" },
  { id: "council", title: "Till elevrådet", prompts: ["Finns det något vi vill att elevrådet ska ta vidare?"], notesLabel: "Det här skickar vi med:", icon: "school", role: "council" },
  { id: "next", title: "Till nästa klassråd", prompts: [], notesLabel: "Det här behöver vi följa upp nästa gång:", icon: "pin", numbered: false, role: "followup" },
].map((p) => Object.freeze({ notesLabel: DEFAULT_NOTES_LABEL, numbered: true, role: null, ...p, prompts: Object.freeze([...p.prompts]) })));

const randomHex = (bytes) => {
  const b = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
};
export const newPointId = () => `p-${randomHex(5)}`;
export const newMeetingId = () => `m-${randomHex(6)}`;
export const isMeetingId = (id) => typeof id === "string" && /^m-[\w-]+$/.test(id);

const oneLine = (s, max) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const pad2 = (n) => String(n).padStart(2, "0");

/** "2026-10-01" för en tidpunkt (lokal tid). */
export function isoDate(ts = Date.now()) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Är det ett giltigt datum "ÅÅÅÅ-MM-DD"? */
export function isIsoDate(s) {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

const dateTs = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d, 12).getTime(); };

/** Veckonumret (ISO) för ett datum "ÅÅÅÅ-MM-DD", eller null. */
export function weekOfDate(s) {
  return isIsoDate(s) ? isoWeek(dateTs(s)).week : null;
}

/** "1 oktober 2026" (lång), "1 okt" (kort) eller "1 okt 2026" (kort med år). */
export function formatDate(s, { short = false, year = !short } = {}) {
  if (!isIsoDate(s)) return "";
  const opts = { day: "numeric", month: short ? "short" : "long", ...(year ? { year: "numeric" } : {}) };
  return new Date(dateTs(s)).toLocaleDateString("sv-SE", opts).replace(/\./g, "");
}

// ---- Mallen ------------------------------------------------------------------

/** En punkt (mall eller möte) — skräp faller bort, fälten får sina gränser. */
function normalizePoint(raw, { withNotes = false } = {}) {
  if (!raw || typeof raw !== "object") return null;
  const title = oneLine(raw.title, MAX_TITLE);
  const prompts = (Array.isArray(raw.prompts) ? raw.prompts : [])
    .map((t) => oneLine(t, MAX_PROMPT)).filter(Boolean).slice(0, MAX_PROMPTS);
  const id = typeof raw.id === "string" && /^[\w-]{1,40}$/.test(raw.id) ? raw.id : null;
  if (!id) return null;
  const label = oneLine(raw.notesLabel, MAX_LABEL);
  const point = {
    id,
    title,
    prompts,
    notesLabel: label || DEFAULT_NOTES_LABEL,
    icon: POINT_ICONS.includes(raw.icon) ? raw.icon : "chat",
    numbered: raw.numbered !== false,
    role: ROLES.has(raw.role) ? raw.role : null,
  };
  if (withNotes) point.notes = typeof raw.notes === "string" ? raw.notes.replace(/\r\n?/g, "\n").slice(0, MAX_NOTES) : "";
  return point;
}

/** Punktlista: unika id, högst en punkt per roll, högst MAX_POINTS. */
function normalizePoints(list, opts) {
  const seenIds = new Set();
  const seenRoles = new Set();
  const out = [];
  for (const raw of Array.isArray(list) ? list : []) {
    const p = normalizePoint(raw, opts);
    if (!p || seenIds.has(p.id)) continue;
    seenIds.add(p.id);
    if (p.role) {
      if (seenRoles.has(p.role)) p.role = null;
      else seenRoles.add(p.role);
    }
    out.push(p);
    if (out.length >= MAX_POINTS) break;
  }
  return out;
}

/** En kopia av standardmallen (fri att ändra), i normaliserad form. */
export const defaultTemplate = () => ({ points: normalizePoints(DEFAULT_POINTS) });

/**
 * Normalisera en sparad mall. Ingen mall, eller en mall utan en enda
 * punkt med rubrik → standardmallen. Punkter utan rubrik faller bort.
 */
export function normalizeTemplate(raw) {
  const points = normalizePoints(raw?.points).filter((p) => p.title);
  return points.length ? { points } : defaultTemplate();
}

/** Är mallen (efter normalisering) samma som standardmallen? */
export function isDefaultTemplate(template) {
  return JSON.stringify(normalizeTemplate(template)) === JSON.stringify(defaultTemplate());
}

/** Mallen ur lärarens settings-dokument. */
export const templateFromSettings = (doc) => normalizeTemplate(doc?.template);

// ---- Sekreterarens förval (molnet: ALDRIG ett elevnamn) ------------------------

/** Lärarens visningsnamn för snabbvalet "Jag" — i lokalt läge "Lärare". */
export const teacherLabel = (name) => oneLine(name, MAX_NAME) || "Lärare";

/**
 * Det enda som får sparas som klassens sekreterarförval: "me" om det
 * valda namnet är läraren själv ("Jag", lärarens namn eller "Lärare"),
 * annars null (förvalet tas bort). Ett elevnamn eller annan fritext
 * sparas alltså aldrig.
 */
export function secretaryPref(value, teacherName) {
  const v = oneLine(value, MAX_NAME).toLocaleLowerCase("sv");
  if (!v) return null;
  const mine = new Set(["jag", "lärare", teacherLabel(teacherName).toLocaleLowerCase("sv")]);
  return mine.has(v) ? "me" : null;
}

/** Nästa settings-dokument efter ett sekreterarval i klassen `cid`. */
export function withSecretaryPref(doc, cid, value, teacherName) {
  const prev = doc?.secretary && typeof doc.secretary === "object" ? doc.secretary : {};
  const { [cid]: _old, ...rest } = prev;
  const clean = Object.fromEntries(Object.entries(rest).filter(([, v]) => v === "me"));
  const pref = secretaryPref(value, teacherName);
  return {
    ...(doc ?? {}),
    id: KLASSRAD_SETTINGS_DOC,
    secretary: pref ? { ...clean, [cid]: pref } : clean,
  };
}

/** Förifylld sekreterare i ett nytt möte i klassen `cid`. */
export function secretaryDefault(doc, cid, teacherName) {
  return doc?.secretary?.[cid] === "me" ? teacherLabel(teacherName) : "";
}

// ---- Mötet --------------------------------------------------------------------

/**
 * Nytt möte: dagens datum och en KOPIA av mallens punkter (tomma
 * anteckningar). Mallen kan sedan ändras utan att mötet påverkas.
 */
export function newMeeting(template, { date = isoDate(), secretary = "", now = Date.now() } = {}) {
  const points = normalizeTemplate(template).points.map((p) => ({ ...p, prompts: [...p.prompts], notes: "" }));
  return {
    id: newMeetingId(),
    date: isIsoDate(date) ? date : isoDate(now),
    chair: "",
    secretary: oneLine(secretary, MAX_NAME),
    points,
    shown: points[0]?.id ?? "all",
    followDone: [],
    createdAt: now,
    editedAt: now,
    rev: 0,
  };
}

/**
 * Normalisera ett sparat möte (null om det inte är ett möte). Mötets
 * punkter är dess EGNA — mallen läses aldrig här.
 */
export function normalizeMeeting(raw) {
  if (!raw || !isMeetingId(raw.id)) return null;
  const points = normalizePoints(raw.points, { withNotes: true });
  const shown = raw.shown === "all" || points.some((p) => p.id === raw.shown) ? raw.shown : (points[0]?.id ?? "all");
  const createdAt = Number(raw.createdAt) || 0;
  return {
    id: raw.id,
    date: isIsoDate(raw.date) ? raw.date : isoDate(createdAt || Date.now()),
    chair: oneLine(raw.chair, MAX_NAME),
    secretary: oneLine(raw.secretary, MAX_NAME),
    points,
    shown,
    followDone: Array.isArray(raw.followDone) ? [...new Set(raw.followDone.filter((k) => typeof k === "string"))].slice(0, 200) : [],
    createdAt,
    editedAt: Number(raw.editedAt) || createdAt,
    rev: Number(raw.rev) || 0,
  };
}

/** Anteckningarna som rader (punktlistan): tomma rader faller bort. */
export const noteLines = (text) => String(text ?? "").split("\n").map((s) => s.trim()).filter(Boolean);

/** Har mötet något ifyllt alls (anteckningar, ordförande, sekreterare)? */
export function hasContent(m) {
  return !!m && (!!m.chair || m.points.some((p) => noteLines(p.notes).length > 0));
}

/** Numret som visas för varje punkt (null = onumrerad), i mötets ordning. */
export function pointNumbers(points) {
  let n = 0;
  return points.map((p) => (p.numbered ? ++n : null));
}

/** Ordning: datum, sedan när mötet skapades. */
const before = (a, b) => (a.date !== b.date ? a.date < b.date : a.createdAt < b.createdAt);

/** Mötena, nyaste först (arkivlistan). */
export function sortMeetings(meetings) {
  return [...meetings].sort((a, b) => (before(a, b) ? 1 : before(b, a) ? -1 : 0));
}

/**
 * "FRÅN FÖRRA KLASSRÅDET": uppföljningen från det senaste TIDIGARE mötet
 * (före `current` — datum, sedan skapelsetid) som har något ifyllt. Raderna
 * under "Till nästa klassråd" (och "Till elevrådet"), var och en med en
 * nyckel så att läraren kan bocka av den i det nya mötet.
 * null = det finns inget tidigare klassråd (rutan syns inte).
 *   { from: { id, date }, groups: [{ role, title, items: [{ key, text }] }] }
 */
export function previousFollowUp(meetings, current) {
  if (!current) return null;
  const prev = sortMeetings(meetings.filter((m) => m && m.id !== current.id && before(m, current) && hasContent(m)))[0];
  if (!prev) return null;
  const groups = [];
  for (const role of FOLLOW_ROLES) {
    const p = prev.points.find((x) => x.role === role);
    const items = noteLines(p?.notes).map((text, i) => ({ key: `${prev.id}:${p.id}:${i}`, text }));
    if (items.length) groups.push({ role, title: p.title, items });
  }
  return { from: { id: prev.id, date: prev.date }, groups };
}

// ---- Skrivflödet: Tab / Ctrl+Enter / Shift+Tab ---------------------------------

/**
 * Vart en tangent i punkt `index`s anteckningsfält flyttar (index för
 * nästa/föregående punkt), eller null = fältets eget beteende.
 *   Ctrl/⌘+Enter        → nästa punkt
 *   Tab i slutet         → nästa punkt (markören sist, ingen markering)
 *   Shift+Tab            → föregående punkt
 * Vid första/sista punkten: null (Tab lämnar fältet som vanligt).
 */
export function notesNavTarget({ key, ctrlKey = false, metaKey = false, shiftKey = false, altKey = false,
  selectionStart = 0, selectionEnd = 0, length = 0, index, count }) {
  if (altKey) return null;
  let to = null;
  if (key === "Enter" && (ctrlKey || metaKey) && !shiftKey) to = index + 1;
  else if (key === "Tab" && !ctrlKey && !metaKey) {
    if (shiftKey) to = index - 1;
    else if (selectionStart === selectionEnd && selectionEnd === length) to = index + 1;
  }
  return to != null && to >= 0 && to < count ? to : null;
}

/** Bläddra den visade punkten: ett steg framåt/bakåt ("all" → första/sista). */
export function stepShown(points, shown, dir) {
  if (!points.length) return "all";
  const i = points.findIndex((p) => p.id === shown);
  if (i < 0) return points[dir > 0 ? 0 : points.length - 1].id;
  return points[Math.min(points.length - 1, Math.max(0, i + dir))].id;
}

// ---- Det eleverna ser -----------------------------------------------------------

/** Mötet som det skickas till elevskärmen (bussen) — inga lärarfält. */
export function publicMeeting(m) {
  if (!m) return null;
  return {
    id: m.id,
    date: m.date,
    chair: m.chair,
    secretary: m.secretary,
    points: m.points.map((p) => ({ ...p, prompts: [...p.prompts] })),
    shown: m.shown,
    followDone: [...m.followDone],
  };
}
