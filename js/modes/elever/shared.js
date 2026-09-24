/**
 * LÄGE 4 — delade hjälpare för Elevlista & noteringar.
 *
 * Principen bakom hela läget: ett MINNESSTÖD för läraren — aldrig ett
 * straffsystem. Här finns därför ingen poängräkning, inga nivåer och
 * ingen automatik som kopplar antal noteringar till åtgärd. Datat är
 * rått material för lärarens egna beslut och samtal.
 *
 * Datamodell (se DATAMODELL.md):
 *   classes/{cid}/students/{id}   — firstName, tag, active, hotkey
 *   classes/{cid}/notes/{id}      — se noteFields nedan
 *   classes/{cid}/settings/elevlista — value: { defaultTypeId, labels, sessionStart }
 *   classes/{cid}/settings/display   — value: { nameDisplay }
 */

import { plansPath as plansPathFor, attribution } from "../../data/plans.js";

// ---- Paths ----

export const studentsPath = (cid) => `classes/${cid}/students`;
export const notesPath = (cid) => `classes/${cid}/notes`;
export const settingsPath = (cid) => `classes/${cid}/settings`;

// ---- Noteringstyper (kind: "typ") ----
// Fast, saklig uppsättning. "Positivt" har egen tangentväg (Shift+tangent)
// så att loggen inte blir en ren negativlista.

export const NOTE_TYPES = [
  { id: "prat", name: "Prat" },
  { id: "stol", name: "Ur stol" },
  { id: "fokus", name: "Annat än uppgiften" },
  { id: "sen", name: "Sen ankomst" },
  { id: "annat", name: "Annat" },
  { id: "positiv", name: "Positivt", positive: true },
];

export const noteTypeById = (id) => NOTE_TYPES.find((t) => t.id === id) ?? null;

// Dämpade etikettfärger (cyklas när läraren skapar egna etiketter)
export const LABEL_COLORS = ["#5d9c76", "#5577b5", "#b05f7d", "#b88540", "#7a63a8", "#4f93a8", "#b3564e", "#937a45"];

// ---- Inställningar (settings/elevlista) ----

export const DEFAULT_SETTINGS = {
  defaultTypeId: "prat",
  labels: [], // [{ id, name, color }] — lärarens egna etiketter för anteckningar
  sessionStart: null, // epoch ms — minneslistan nollställs genom att flytta denna
};

export async function loadModeSettings(data, cid) {
  const doc = await data.get(settingsPath(cid), "elevlista");
  return { ...DEFAULT_SETTINGS, ...(doc?.value ?? {}) };
}

export async function saveModeSettings(data, cid, value) {
  await data.put(settingsPath(cid), { id: "elevlista", value });
}

export async function loadNameDisplay(data, cid) {
  const doc = await data.get(settingsPath(cid), "display");
  return doc?.value?.nameDisplay === "initials";
}

export async function saveNameDisplay(data, cid, initials) {
  await data.put(settingsPath(cid), {
    id: "display",
    value: { nameDisplay: initials ? "initials" : "first" },
  });
}

// ---- Pågående lektion (läses ur Läge 2:s lessonPlans) ----

export const todayISO = (d = new Date()) => {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

const minutesOf = (hhmm) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm ?? ""));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/**
 * Blocket i dagens lektionsplanering som pågår just nu, eller null.
 * Returnerar en SNAPSHOT { date, start, end, subjectId, title } som
 * sparas på noteringen — så att mönstervyer funkar även om
 * planeringen ändras i efterhand.
 */
export async function currentLessonBlock(data, cid) {
  try {
    const plans = await data.list(plansPathFor(cid));
    const date = todayISO();
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    for (const plan of plans) {
      if (plan.date !== date) continue;
      // En planering i Läge 2 ÄR ett block: start/end/subjectId/name ligger
      // direkt på planeringen. (Äldre form med plan.blocks stöds också.)
      const blocks = plan.blocks ?? [{ start: plan.start, end: plan.end, subjectId: plan.subjectId, title: plan.name }];
      for (const b of blocks) {
        const s = minutesOf(b.start);
        const e = minutesOf(b.end);
        if (s != null && e != null && s <= nowMin && nowMin < e) {
          return { date, start: b.start, end: b.end, subjectId: b.subjectId ?? null, title: b.title ?? "" };
        }
      }
    }
  } catch { /* planering saknas — noteringen får lesson: null */ }
  return null;
}

// ---- Skapa notering ----

/**
 * Skapar en notering med automatiskt datum/tid (createdAt sätts av
 * datalagret), lärar-attribution (createdBy = uid, createdByName =
 * visningsnamn) och snapshot av pågående lektion. Läraren fyller
 * aldrig i tid eller lektion själv.
 *
 * kind: "typ" (kategoriserad snabbnotering) | "text" (fritext) | "insats"
 */
export async function createNote(data, cid, fields) {
  const lesson = await currentLessonBlock(data, cid);
  const doc = {
    kind: "typ",
    typeId: null,
    positive: false,
    text: "",
    labelId: null,
    followUp: false,
    helped: null, // endast kind "insats": "ja" | "delvis" | "nej"
    lesson,
    ...attribution(),
    ...fields,
  };
  const id = await data.put(notesPath(cid), doc);
  return id;
}

/** Lärarnamn för visning ur ett pass/en notering — gamla dokument utan
 *  attribution visas som "okänd lärare". */
export function teacherLabel(doc) {
  return doc?.createdByName || "okänd lärare";
}

// ---- Mönsterhjälpare ----

export const MOMENT_BUCKETS = ["Första 10 min", "Mitt i passet", "Sista 10 min", "Utanför lektion"];

/** När i lektionen föll noteringen? (grovt men ärligt — inga gissningar) */
export function momentOf(note) {
  const l = note.lesson;
  const s = minutesOf(l?.start);
  const e = minutesOf(l?.end);
  if (s == null || e == null) return "Utanför lektion";
  const t = new Date(note.createdAt);
  const min = t.getHours() * 60 + t.getMinutes() - s;
  if (min < 10) return "Första 10 min";
  if (min >= e - s - 10) return "Sista 10 min";
  return "Mitt i passet";
}

export const WEEKDAYS = ["Måndag", "Tisdag", "Onsdag", "Torsdag", "Fredag", "Lördag", "Söndag"];

export function weekdayOf(note) {
  return WEEKDAYS[(new Date(note.createdAt).getDay() + 6) % 7];
}

export function hourOf(note) {
  const h = new Date(note.createdAt).getHours();
  return `${String(h).padStart(2, "0")}–${String(h + 1).padStart(2, "0")}`;
}

// ---- Formattering & säkerhet ----

export function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

export const fmtTime = (ms) =>
  new Date(ms).toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" });

export const fmtDate = (ms) =>
  new Date(ms).toLocaleDateString("sv-SE", { day: "numeric", month: "short" });

export const fmtDateTime = (ms) => `${fmtDate(ms)} ${fmtTime(ms)}`;

/** Sorterade aktiva elever (svensk ordning). */
export function activeStudents(students) {
  return students
    .filter((s) => s.active !== false)
    .sort((a, b) => String(a.firstName).localeCompare(String(b.firstName), "sv"));
}

/** Giltig kortkommandotangent: EN bokstav eller siffra (inga app-tangenter). */
export function isAssignableKey(key) {
  return typeof key === "string" && /^[a-zA-ZåäöÅÄÖ0-9]$/.test(key);
}
