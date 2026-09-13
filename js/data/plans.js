/**
 * LEKTIONSPLANERINGAR — PRIVATA per lärare.
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

import { SESSION_KEY } from "../auth.js";

/** Nuvarande lärares id (Firebase-uid, eller "local" utan Firebase). */
export function currentUid() {
  try { return localStorage.getItem(SESSION_KEY) || "local"; } catch { return "local"; }
}

/** Path till en lärares privata lektionsplaneringar för en klass. */
export function plansPath(cid, uid = currentUid()) {
  return `teachers/${uid}/classes/${cid}/lessonPlans`;
}
