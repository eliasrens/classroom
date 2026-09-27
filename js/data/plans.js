/**
 * LEKTIONSPLANERINGAR — PRIVATA per lärare (planeringar + vad elevskärmen visar).
 *
 * Till skillnad från klasser, elever, noteringar, pass och inställningar
 * (som DELAS av alla inloggade lärare, se DATAMODELL.md) är varje lärares
 * lektionsplaneringar privata: bara läraren själv läser och skriver sina
 * egna planeringar. Därför lagras de under lärarens uid i stället för
 * under den delade klassnoden:
 *
 *   teachers/{uid}/classes/{cid}/lessonPlans/{planId}
 *
 * Säkerhetsreglerna (firestore.rules) speglar detta: hela subträdet
 * teachers/{uid}/** kräver request.auth.uid == uid. Pathen bär alltså
 * ägarskapet — ingen extra fråga/where-sats behövs för att en lyssnare
 * ska slippa permission-denied (jfr en delad kollektion med ownerUid-fält).
 *
 * uid = Firebase-uid för inloggad lärare, eller "local" i rent lokalt
 * läge (ingen Firebase). Elevskärmen delar lärarens webbläsarsession och
 * därmed samma uid, så den ser lärarens egna planeringar på projektorn.
 */

import { SESSION_KEY, currentTeacherName } from "../auth.js";

/** Nuvarande lärares id (Firebase-uid, eller "local" utan Firebase). */
export function currentUid() {
  try { return localStorage.getItem(SESSION_KEY) || "local"; } catch { return "local"; }
}

/** Attributionsfält för nya delade dokument (pass, noteringar). */
export function attribution() {
  return { createdBy: currentUid(), createdByName: currentTeacherName() };
}

/** Path till en lärares privata lektionsplaneringar för en klass. */
export function plansPath(cid, uid = currentUid()) {
  return `teachers/${uid}/classes/${cid}/lessonPlans`;
}

/**
 * Lektionslägets inställning — också PRIVAT per lärare (issue #39):
 *
 *   teachers/{uid}/classes/{cid}/settings/lektion
 *     value: { presentedPlanId }   — planeringen som elevskärmen visar
 *
 * Ändras BARA när läraren trycker "Visa på elevskärm" (issue #88,
 * lägets onPresent). Elevskärmen delar
 * lärarens session (samma uid) och läser samma dokument; en annan lärare
 * i klassen kan varken läsa eller skriva det. (Den gamla DELADE
 * classes/{cid}/settings/lektion → activePlanId läses inte längre.)
 */
export const LESSON_SETTINGS_DOC = "lektion";
export function lessonSettingsPath(cid, uid = currentUid()) {
  return `teachers/${uid}/classes/${cid}/settings`;
}

const pad2 = (n) => String(n).padStart(2, "0");
const isoLocal = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const minutesOf = (hhmm) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm ?? ""));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/**
 * Planeringen elevskärmen visar, eller null (tomläge).
 * `doc` = lärarens privata settings/lektion (null = finns inte ännu).
 *  - Dokumentet finns → exakt presentedPlanId. Saknas planeringen (t.ex.
 *    borttagen) blir det tomläge — aldrig ett tyst byte till en annan.
 *  - Dokumentet finns inte (första användningen) → dagens planering som
 *    förval: den som senast började, annars dagens första.
 * (Flyttad hit från lektion.js i issue #103 — "Skicka kopia till klass"
 * behöver samma regel för målklassen.)
 */
export function presentedPlanOf(plans, doc, now) {
  if (doc) {
    const id = doc.value?.presentedPlanId ?? null;
    return id ? plans.find((p) => p.id === id) ?? null : null;
  }
  const d = new Date(now);
  const today = isoLocal(d);
  const nowMin = d.getHours() * 60 + d.getMinutes();
  const todays = plans.filter((p) => p.date === today).sort((a, b) =>
    (a.start ?? "").localeCompare(b.start ?? "") || (a.name ?? "").localeCompare(b.name ?? "", "sv"));
  const started = todays.filter((p) => (minutesOf(p.start) ?? Infinity) <= nowMin);
  return started.at(-1) ?? todays[0] ?? null;
}

/**
 * Planeringen som är öppen i redigeraren — bara UI-tillstånd för just
 * den här fliken (sessionStorage), aldrig datalagret. Översikten sätter
 * den innan den byter till Lektionsplanering.
 */
const editingKey = (cid) => `classroom:lektion:editing:${currentUid()}:${cid}`;
export function getEditingPlanId(cid) {
  try { return sessionStorage.getItem(editingKey(cid)) || null; } catch { return null; }
}
export function setEditingPlanId(cid, id) {
  try {
    if (id) sessionStorage.setItem(editingKey(cid), id);
    else sessionStorage.removeItem(editingKey(cid));
  } catch { /* ingen lagring — minnet räcker */ }
}
