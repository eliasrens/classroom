/**
 * INTEGRITET / GDPR — tvärgående dataskydd (Läge 5).
 *
 * Tre funktioner samlade på ett ställe:
 *
 *  1. AUTO-RADERING av noteringar efter valbart antal veckor. Kör mot
 *     noteringsmodellen från Läge 4 (classes/{cid}/notes) och tar bort
 *     allt äldre än gränsen utifrån `createdAt`. Inställningen bor per
 *     klass i settings/privacy → value.noteRetentionWeeks (null = spara
 *     tills vidare). Anropas när en klass öppnas (se app.js) så gamla
 *     noteringar rensas av sig själv utan att läraren behöver tänka på det.
 *
 *  2. RADERA ALL DATA för en klass — elever, planeringar, noteringar,
 *     pass, inställningar OCH själva klassdokumentet. Går via datalagret
 *     så att raderingarna även propagerar till Firestore.
 *
 *  3. Endast förnamn lagras om elever (se DATAMODELL.md / js/lib/names.js);
 *     namnvisningen (förnamn ↔ initialer) styrs av settings/display och
 *     hanteras av namnhjälparna — den här modulen rör inte det.
 *
 * INGET av detta kan nå elevskärmen: noteringar renderas bara i
 * lärarlägen (se registry STUDENT_MODE_IDS) och all data-radering sker
 * i lärarvyn.
 */

import { plansPath as plansPathFor } from "../data/plans.js";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export const PRIVACY_SETTING_ID = "privacy";

/** Giltiga val för hur länge noteringar sparas (veckor). null = tills vidare. */
export const RETENTION_OPTIONS = [
  { weeks: null, label: "Spara tills vidare" },
  { weeks: 2, label: "2 veckor" },
  { weeks: 4, label: "4 veckor" },
  { weeks: 8, label: "8 veckor" },
  { weeks: 12, label: "12 veckor (en termin)" },
  { weeks: 20, label: "20 veckor" },
];

const settingsPath = (cid) => `classes/${cid}/settings`;
const notesPath = (cid) => `classes/${cid}/notes`;

/** Läs klassens integritetsinställning. → { noteRetentionWeeks: number|null } */
export async function loadPrivacy(data, cid) {
  const doc = await data.get(settingsPath(cid), PRIVACY_SETTING_ID);
  const weeks = doc?.value?.noteRetentionWeeks;
  return { noteRetentionWeeks: Number.isFinite(weeks) && weeks > 0 ? weeks : null };
}

/** Spara klassens integritetsinställning. weeks = null → spara tills vidare. */
export async function savePrivacy(data, cid, { noteRetentionWeeks }) {
  const weeks = Number.isFinite(noteRetentionWeeks) && noteRetentionWeeks > 0
    ? Math.round(noteRetentionWeeks) : null;
  await data.put(settingsPath(cid), {
    id: PRIVACY_SETTING_ID,
    value: { noteRetentionWeeks: weeks },
  });
  return weeks;
}

/**
 * Radera noteringar äldre än `weeks` veckor för en klass. Returnerar
 * antalet borttagna. weeks = null/0 → gör ingenting (spara tills vidare).
 * Idempotent och ofarlig att anropa ofta.
 */
export async function purgeOldNotes(data, cid, weeks, now = Date.now()) {
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

/** Bekvämt: läs inställningen och kör raderingen i ett svep. */
export async function runRetention(data, cid, now = Date.now()) {
  const { noteRetentionWeeks } = await loadPrivacy(data, cid);
  return purgeOldNotes(data, cid, noteRetentionWeeks, now);
}

/**
 * Radera ALL data för en klass: varje dokument i varje delad subkollektion
 * (students, notes, sessions, settings, …), den inloggade lärarens egna
 * privata planeringar för klassen, samt själva klassdokumentet i "classes".
 * Går via datalagret så att raderingarna även synkas bort ur Firestore.
 * Returnerar antal borttagna dokument.
 */
export async function deleteAllClassData(data, cid) {
  if (!cid) return 0;
  let removed = 0;
  // Alla subkollektioner under klassen (namnen behöver inte vara kända).
  // Delad klassdata: students, notes, sessions, settings, …
  const paths = await data.collections(`classes/${cid}/`);
  // Den inloggade lärarens PRIVATA planeringar för klassen ligger utanför
  // classes/{cid}/ (teachers/{uid}/…) — ta med dem. Andra lärares privata
  // planeringar rörs aldrig (och kan inte röras, se firestore.rules).
  paths.push(plansPathFor(cid));
  for (const path of paths) {
    const docs = await data.list(path);
    for (const d of docs) {
      await data.remove(path, d.id);
      removed++;
    }
  }
  // Själva klassdokumentet sist.
  await data.remove("classes", cid);
  removed++;
  return removed;
}
