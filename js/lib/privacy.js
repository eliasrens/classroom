/**
 * INTEGRITET / GDPR — tvärgående dataskydd (Läge 5, skärpt i issue #32).
 *
 * Sedan issue #32 lagras ALL elevdata (elevlista, noteringar, Bra
 * jobbat) BARA lokalt på varje lärardator (js/data/local-only.js) —
 * molnet får enbart klasstatistik. Den här modulen hanterar:
 *
 *  1. LOKAL GALLRING: noteringar auto-raderas efter valbart antal
 *     veckor. Inställningen är numera LOKAL per dator
 *     (classes/{cid}/privacy → value.noteRetentionWeeks, routas till
 *     lokal lagring av datalagret). Standard: 12 veckor (en termin),
 *     med val ner till 1 vecka. Gallringen tar bara bort de LOKALA
 *     noteringarna — de anonyma noteStats-strecken i molnet är
 *     klasstatistik utan elevkoppling och behålls som klassens
 *     historik (arkivet i Statistik).
 *
 *  2. RADERA ALL DATA för en klass — lokalt (elever, noteringar, Bra
 *     jobbat, gallringsinställning) OCH klassens molndata (pass,
 *     noteStats, inställningar, klassdokumentet). Går via datalagret
 *     som routar per path: lokala samlingar raderas direkt, delade
 *     propagerar till Firestore.
 *
 *  3. Endast förnamn lagras om elever (se DATAMODELL.md /
 *     js/lib/names.js); namnvisningen hanteras av namnhjälparna.
 *
 * INGET av detta kan nå elevskärmen: noteringar renderas bara i
 * lärarlägen (se registry STUDENT_MODE_IDS) och all data-radering sker
 * i lärarvyn.
 */

import { plansPath as plansPathFor } from "../data/plans.js";
import { serverNow } from "./clock.js";
import { classActionsPath, classActionRepliesPath } from "./class-actions.js";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export const PRIVACY_SETTING_ID = "privacy";

/** Standard: 12 veckor (en termin). */
export const DEFAULT_RETENTION_WEEKS = 12;

/** Giltiga val för hur länge noteringar sparas lokalt (veckor). */
export const RETENTION_OPTIONS = [
  { weeks: 1, label: "1 vecka" },
  { weeks: 2, label: "2 veckor" },
  { weeks: 4, label: "4 veckor" },
  { weeks: 8, label: "8 veckor" },
  { weeks: 12, label: "12 veckor (en termin)" },
  { weeks: 20, label: "20 veckor" },
];

// LOKAL samling (routas av datalagret till js/data/local-only.js).
const privacyPath = (cid) => `classes/${cid}/privacy`;
const notesPath = (cid) => `classes/${cid}/notes`;

/**
 * Läs datorns gallringsinställning.
 * → { noteRetentionWeeks: number, awaitingChoice: boolean }
 *
 * awaitingChoice: SKYDD efter uppgraderingen till lokal elevdata
 * (issue #32). Hade datorn förut "Spara tills vidare" (eller ingen
 * inställning alls — det gamla standardvalet) sätter migreringen
 * flaggan, och gallringen körs INTE förrän läraren aktivt bekräftat
 * en lagringstid i Översikten. Utan skyddet hade de lokala
 * noteringarna äldre än 12 veckor raderats tyst vid första öppningen
 * — och lokala noteringar finns ingen annanstans.
 */
export async function loadPrivacy(data, cid) {
  const doc = await data.get(privacyPath(cid), PRIVACY_SETTING_ID);
  const weeks = doc?.value?.noteRetentionWeeks;
  return {
    noteRetentionWeeks: Number.isFinite(weeks) && weeks > 0 ? weeks : DEFAULT_RETENTION_WEEKS,
    awaitingChoice: Boolean(doc?.value?.awaitingChoice),
  };
}

/** Spara datorns gallringsinställning. Ett aktivt val häver alltid
 *  uppgraderingsskyddet (awaitingChoice skrivs inte tillbaka). */
export async function savePrivacy(data, cid, { noteRetentionWeeks }) {
  const weeks = Number.isFinite(noteRetentionWeeks) && noteRetentionWeeks > 0
    ? Math.round(noteRetentionWeeks) : DEFAULT_RETENTION_WEEKS;
  await data.put(privacyPath(cid), {
    id: PRIVACY_SETTING_ID,
    value: { noteRetentionWeeks: weeks },
  });
  return weeks;
}

/**
 * Radera LOKALA noteringar äldre än `weeks` veckor för en klass.
 * Returnerar antalet borttagna. Idempotent och ofarlig att anropa ofta.
 * De anonyma molnstrecken behålls (klasstatistik utan elevkoppling).
 */
export async function purgeOldNotes(data, cid, weeks, now = serverNow()) {
  if (!cid || !Number.isFinite(weeks) || weeks <= 0) return 0;
  const cutoff = now - weeks * WEEK_MS;
  let removed = 0;
  try {
    const notes = await data.list(notesPath(cid));
    for (const n of notes) {
      const ts = n.createdAt ?? n.updatedAt ?? 0;
      if (ts && ts < cutoff) {
        await data.remove(notesPath(cid), n.id);
        removed++;
      }
    }
  } catch (err) {
    console.warn("[privacy] auto-radering av noteringar misslyckades:", err);
  }
  return removed;
}

/** Bekvämt: läs inställningen och kör gallringen i ett svep.
 *  Körs INTE medan uppgraderingsskyddet väntar på lärarens val. */
export async function runRetention(data, cid, now = serverNow()) {
  const { noteRetentionWeeks, awaitingChoice } = await loadPrivacy(data, cid);
  if (awaitingChoice) return 0;
  return purgeOldNotes(data, cid, noteRetentionWeeks, now);
}

/**
 * Radera ALL data för en klass: varje dokument i varje subkollektion —
 * både de LOKALA (students, notes, praise, praiseArchive, privacy) och
 * de delade (sessions, settings, noteStats, …) — den inloggade lärarens
 * egna privata planeringar för klassen, samt själva klassdokumentet.
 * Delade raderingar propagerar till Firestore via datalagret.
 * Returnerar antal borttagna dokument.
 */
export async function deleteAllClassData(data, cid) {
  if (!cid) return 0;
  let removed = 0;
  // Alla subkollektioner under klassen (lokala + synkade; namnen behöver
  // inte vara kända i förväg). noteStats tas med explicit ifall
  // samlingen inte hunnit bevakas/cachas i denna session.
  const paths = new Set(await data.collections(`classes/${cid}/`));
  paths.add(`classes/${cid}/noteStats`);
  // Den inloggade lärarens PRIVATA planeringar för klassen ligger utanför
  // classes/{cid}/ (teachers/{uid}/…) — ta med dem. Andra lärares privata
  // planeringar rörs aldrig (och kan inte röras, se firestore.rules).
  paths.add(plansPathFor(cid));
  // Klassåtgärder (issue #34) får bara tas bort av upphovspersonen — UTOM
  // när klassdokumentet redan är borta (firestore.rules). De raderas därför
  // EFTER klassdokumentet; outboxen pushar i ordning.
  const owned = [classActionsPath(cid), classActionRepliesPath(cid)];
  for (const p of owned) paths.delete(p);
  const removeAll = async (path) => {
    const docs = await data.list(path);
    for (const d of docs) {
      await data.remove(path, d.id);
      removed++;
    }
  };
  for (const path of paths) await removeAll(path);
  // Själva klassdokumentet sist (före klassåtgärderna, se ovan).
  await data.remove("classes", cid);
  removed++;
  for (const path of owned) await removeAll(path);
  return removed;
}
