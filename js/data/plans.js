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
 * Ändras BARA när läraren trycker "Visa för eleverna". Elevskärmen delar
 * lärarens session (samma uid) och läser samma dokument; en annan lärare
 * i klassen kan varken läsa eller skriva det. (Den gamla DELADE
 * classes/{cid}/settings/lektion → activePlanId läses inte längre.)
 */
export const LESSON_SETTINGS_DOC = "lektion";
export function lessonSettingsPath(cid, uid = currentUid()) {
  return `teachers/${uid}/classes/${cid}/settings`;
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
