/**
 * MORGONSKÄRMEN — delad data-logik (Läge 1).
 *
 * Morgonskärmens tillstånd lever i klassens inställningar under nyckeln
 * "morningScreen" (se DATAMODELL.md: classes/{id}/settings/morningScreen).
 * Både lärarvyn och elevvyn läser och skriver via detta lager, så
 * allt syncar automatiskt genom datalagret + storage-eventet.
 *
 * Ingenting här rör DOM — bara ren datamodell och härledningar.
 */

import { weekKey, weekStartFromKey, startOfWeek } from "./week.js";

export const MORNING_KEY = "morningScreen";
export const settingsPath = (classId) => `classes/${classId}/settings`;

export const WEEKDAYS = ["Måndag", "Tisdag", "Onsdag", "Torsdag", "Fredag"];

/** Dagens veckodag (Mån–Fre); helg → Måndag. */
export function todayWeekday() {
  const d = new Date().getDay(); // 0 sön … 6 lör
  return WEEKDAYS[Math.min(Math.max(d - 1, 0), 4)];
}

/**
 * De FASTA uppgifterna (Bilaga B). Panelens etikett och elevtexten är
 * TVÅ olika saker — behåll det. "Starten" har en veckodags-dropdown vars
 * val bygger elevtexten ("Starten – Onsdag").
 */
function seedTasks() {
  return [
    { id: "starten",    kind: "starten", label: "Starten",              weekday: todayWeekday(), checked: false, checkedAt: 0 },
    { id: "tyst-matte", kind: "fixed",   label: "Tyst läsning/Matte",   studentText: "Tyst läsning eller mattebok", checked: false, checkedAt: 0 },
    { id: "tyst",       kind: "fixed",   label: "Tyst läsning (enbart)", studentText: "Läs tyst i bänkboken",       checked: false, checkedAt: 0 },
    { id: "matte",      kind: "fixed",   label: "Matteboken (enbart)",  studentText: "Ta fram matteboken",          checked: false, checkedAt: 0 },
  ];
}

/**
 * Naturbilder (Unsplash) — behåll id-formatet ur specen. En bild som
 * inte laddar faller tillbaka på en lugn färgbakgrund (hanteras i vyn).
 */
export const UNSPLASH_IDS = [
  "1506905925346-21bda4d32df4", // bergskedja i gryning
  "1470071459604-3b5ec3a7fe05", // dimmig skog
  "1441974231531-c6227db76b6e", // sol genom skog
  "1501785888041-af3ef285b470", // sjö och berg
  "1472214103451-9374bd1c798e", // gröna kullar
  "1447752875215-b2761acb3c5d", // skogsstig
  "1518495973542-4542c06a5843", // sol genom grenar
  "1439066615861-d1af74d74000", // höstskog uppifrån
  "1426604966848-d7adac402bff", // dal med flod
  "1469474968028-56623f02e42e", // bergstopp mot himmel
];

export const unsplashUrl = (id) =>
  `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=1920&q=80`;

/** Ger giltig, ifylld inställningsstruktur oavsett vad som fanns sparat. */
export function normalize(value) {
  const v = value && typeof value === "object" ? value : {};
  const tasks = Array.isArray(v.tasks) && v.tasks.length ? v.tasks.map(normTask) : seedTasks();
  return {
    greeting: {
      variant: v.greeting?.variant === "valkommen" ? "valkommen" : "godmorgon",
      override: typeof v.greeting?.override === "string" ? v.greeting.override : "",
    },
    tasks,
    showNametavla: !!v.showNametavla,
    praise: Array.isArray(v.praise) ? v.praise.map(normPraise).filter(Boolean) : [],
    // Veckan som Bra jobbat-listan hör till ("2026-W39"). Listan töms
    // och arkiveras första gången appen öppnas en ny vecka (week-rhythm.js).
    weekOf: typeof v.weekOf === "string" ? v.weekOf : null,
    background: {
      current: typeof v.background?.current === "string" ? v.background.current : "",
      extraUrls: Array.isArray(v.background?.extraUrls) ? v.background.extraUrls.filter((u) => typeof u === "string") : [],
    },
  };
}

function normTask(t) {
  const base = {
    id: String(t?.id ?? crypto.randomUUID?.() ?? Date.now() + Math.random()),
    kind: t?.kind === "starten" ? "starten" : t?.kind === "fixed" ? "fixed" : "custom",
    label: String(t?.label ?? ""),
    checked: !!t?.checked,
    checkedAt: Number(t?.checkedAt) || 0,
  };
  if (base.kind === "starten") base.weekday = WEEKDAYS.includes(t?.weekday) ? t.weekday : todayWeekday();
  else base.studentText = String(t?.studentText ?? t?.label ?? "");
  return base;
}

function normPraise(p) {
  if (!p || typeof p !== "object") return null;
  if (p.kind === "student" && p.studentId) return { id: String(p.id ?? p.studentId), kind: "student", studentId: String(p.studentId) };
  if (p.kind === "free" && String(p.text ?? "").trim()) return { id: String(p.id ?? Date.now()), kind: "free", text: String(p.text).trim() };
  return null;
}

/** Elevtexten för en uppgift (panel-etiketten ≠ elevtexten). */
export function studentTextFor(task) {
  if (task.kind === "starten") return `Starten – ${task.weekday}`;
  return task.studentText || task.label;
}

/** Ikryssade uppgifter i ikryssningsordning (checkedAt stigande). */
export function orderedTasks(settings) {
  return settings.tasks
    .filter((t) => t.checked)
    .sort((a, b) => (a.checkedAt || 0) - (b.checkedAt || 0));
}

/** Hälsningstexten enligt klassval + variant + ev. redigerad override. */
export function greetingText(settings, activeClass) {
  const override = settings.greeting?.override?.trim();
  if (override) return override;
  if (!activeClass) return "Välkommen!";
  const word = settings.greeting?.variant === "valkommen" ? "Välkommen" : "Godmorgon";
  return `${word} ${activeClass.name}!`;
}

// ---- Veckorytm: Bra jobbat gäller innevarande vecka ----

/**
 * Hör listan till en TIDIGARE vecka (ännu ej tömd)? Då visas den inte —
 * vyn är ren från måndag 00:00 även innan tömningen hunnit sparas (t.ex.
 * offline). Saknad weekOf (äldre data) räknas som innevarande vecka; en
 * weekOf i framtiden (fel klocka på någon enhet) rörs inte.
 */
export function praiseIsStale(settings, now = Date.now()) {
  const start = weekStartFromKey(settings?.weekOf);
  return start != null && start < startOfWeek(now);
}

/** Bra jobbat-listan som ska VISAS nu (tom om den hör till förra veckan). */
export function currentPraise(settings, now = Date.now()) {
  return praiseIsStale(settings, now) ? [] : (settings?.praise ?? []);
}

// ---- Läsning/skrivning mot datalagret ----

export async function loadMorning(data, classId) {
  if (!classId) return normalize(null);
  const doc = await data.get(settingsPath(classId), MORNING_KEY);
  return normalize(doc?.value);
}

export async function saveMorning(data, classId, settings) {
  if (!classId) return; // ingen klass vald — ändringar blir efemära
  await data.put(settingsPath(classId), { id: MORNING_KEY, value: settings });
}

/**
 * Byt BARA bakgrunden — mot senaste versionen av dokumentet (servern när
 * Firebase finns). Slumpningen sker vid varje sidladdning, ofta innan
 * molndatan hunnit komma: en vanlig put av den lokala (kanske inaktuella)
 * kopian skulle då skriva över andra lärares ändringar — t.ex. måndagens
 * tömning av Bra jobbat, som annars kom tillbaka.
 */
export async function saveBackground(data, classId, url) {
  if (!classId) return;
  await data.once(settingsPath(classId), MORNING_KEY, (doc) => {
    const value = normalize(doc?.value);
    if (doc && value.background.current === url) return null;
    value.background.current = url;
    value.weekOf ??= weekKey();
    return [{ path: settingsPath(classId), doc: { ...(doc ?? {}), id: MORNING_KEY, value } }];
  }, { allowLocal: true });
}
