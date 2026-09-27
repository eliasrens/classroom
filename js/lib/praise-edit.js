/**
 * BRA JOBBAT — delad ändringslogik (issue #112).
 *
 * Morgonskärmens panel och Lektionsplaneringens fält "Visa Bra jobbat"
 * redigerar SAMMA lista: den LOKALA classes/{cid}/praise → "board"
 * (elevdata, aldrig i molnet — se js/lib/morning.js). Här ligger det som
 * ska fungera likadant i båda: vad en kryssruta, en fritext och "Töm"
 * gör med listan, och regeln för en inaktuell lista.
 *
 * Ingenting här rör DOM (redigeraren: js/ui/praise-editor.js).
 */

import { praiseIsStale } from "./morning.js";
import { rolloverPraise } from "./week-rhythm.js";
import { weekKey } from "./week.js";
import { serverNow } from "./clock.js";

const newId = () => crypto.randomUUID?.() ?? String(Date.now());

/** Är eleven med i listan? */
export function hasPraiseStudent(praise, studentId) {
  return (praise ?? []).some((p) => p.kind === "student" && p.studentId === studentId);
}

/** Kryssa i/ur en elev. Returnerar { praise, added } — ny lista, rör inte indata. */
export function togglePraiseStudent(praise, studentId) {
  const list = praise ?? [];
  const has = hasPraiseStudent(list, studentId);
  return {
    praise: has
      ? list.filter((p) => !(p.kind === "student" && p.studentId === studentId))
      : [...list, { id: studentId, kind: "student", studentId }],
    added: !has,
  };
}

/** Lägg till fritext sist. Tom text → null (ingenting ska skrivas). */
export function addPraiseFree(praise, text, id = newId()) {
  const t = String(text ?? "").trim();
  if (!t) return null;
  return [...(praise ?? []), { id, kind: "free", text: t }];
}

/**
 * Utgångsläget för en ändring: en KOPIA av tillståndet ({ praise, weekOf },
 * gärna med fler fält — de följer med) där en lista från en tidigare vecka
 * är tömd och weekOf är innevarande vecka.
 */
export function freshPraiseState(state, now = serverNow()) {
  const next = structuredClone(state);
  if (praiseIsStale(next, now)) next.praise = [];
  next.weekOf = weekKey(now);
  return next;
}

/**
 * Gör en ändring i Bra jobbat-listan. Hör listan fortfarande till förra
 * veckan (tömningen har inte hunnit ske, t.ex. offline) arkiveras och
 * töms den FÖRST — annars hamnar nya namn i förra veckans lista.
 *
 *   get()        → nuvarande tillstånd ({ praise, weekOf, … }), läses EFTER
 *                  arkiveringen så att en watch hunnit uppdatera det
 *   fn(next)     → ändrar next.praise (och ev. vyns egna fält) på plats
 *   commit(next) → vyn ritar om och sparar
 */
export async function editPraise({ data, classId, get, commit }, fn) {
  if (praiseIsStale(get())) await rolloverPraise(data, classId, { allowLocal: true });
  const next = freshPraiseState(get()); // rollover misslyckades helt → börja ändå rent
  fn(next);
  await commit(next);
}
