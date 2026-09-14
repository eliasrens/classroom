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
