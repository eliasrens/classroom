/**
 * "SKICKA KOPIA TILL KLASS…" — logiken (issue #103). Dialogen ligger i
 * js/ui/send-plan-dialog.js; det här är de rena delarna som testas i
 * docs/test-send-plan.mjs.
 *
 * Läraren har samma ämne i två klasser och planeringarna är ofta
 * identiska utom klockslaget. En kopia skickas till en annan klass:
 *
 *  - Kopian är OBEROENDE: nytt id, ownerUid = nuvarande lärare. Namn,
 *    ämne, fält och show kopieras; datum och tider kommer från dialogen
 *    (vid flera på en gång behåller varje planering sina egna).
 *  - Den sparas i målklassens PRIVATA plansPath(målCid) — det är samma
 *    lärares planeringar, bara i en annan klass.
 *  - Ett EGET ämne (inte i den inbyggda paletten) läggs först till i
 *    målklassens DELADE classes/{cid}/settings/subjects om det saknas där
 *    (id, namn, färg) — planeringen får aldrig hamna utan färg/ämne. Det
 *    skrivs med data.once (transaktion mot serverns version när vi är
 *    uppkopplade, annars lokalt) så att andra lärares egna ämnen i
 *    målklassen aldrig skrivs över, och ämnet aldrig dubbleras.
 *  - Kopian visas INTE på målklassens elevskärm: presentedPlanId rörs
 *    inte. Undantag som skyddar just det: har läraren aldrig valt något i
 *    målklassen (inget settings/lektion-dokument) visar elevskärmen
 *    "dagens planering" som förval — och det kunde då bli kopian. Då låses
 *    förvalet fast på det som visas JUST NU (samma pinDefault som
 *    lektionsläget gör före varje ändring), innan kopian sparas.
 *  - Allt går via datalagret (offline-först) — inget nytt nätverksberoende.
 */

import { SUBJECTS } from "./color.js";
import {
  currentUid, plansPath, lessonSettingsPath, LESSON_SETTINGS_DOC, presentedPlanOf,
} from "../data/plans.js";

export const SUBJECTS_DOC = "subjects";
/** Klassens DELADE inställningar (egna ämnen, namnvisning …). */
export const classSettingsPath = (cid) => `classes/${cid}/settings`;

const clone = (v) => JSON.parse(JSON.stringify(v ?? {}));

/**
 * Kopian av en (normaliserad) planering. `when` = { date, start, end } från
 * dialogen; utelämnade värden tas från originalet.
 */
export function buildCopy(plan, when = {}, uid = currentUid()) {
  const src = plan ?? {};
  return {
    ownerUid: uid,
    name: src.name ?? "Ny planering",
    date: when.date ?? src.date ?? "",
    subjectId: src.subjectId ?? "so",
    start: when.start ?? src.start ?? "",
    end: when.end ?? src.end ?? "",
    fields: clone(src.fields),
    show: clone(src.show),
  };
}

/** Finns ämnet i den inbyggda paletten (och alltså i alla klasser)? */
export const isBuiltinSubject = (id) => SUBJECTS.some((s) => s.id === id);

/**
 * Målklassens nya ämneslista med `subject` tillagt, eller null om det
 * redan finns där (på id) — då skrivs ingenting.
 */
export function withSubject(list, subject) {
  const cur = Array.isArray(list) ? list : [];
  if (!subject?.id || cur.some((s) => s?.id === subject.id)) return null;
  return [...cur, { id: subject.id, name: subject.name, color: subject.color }];
}

/**
 * Se till att planeringens egna ämne finns i målklassen. `subjects` =
 * ursprungsklassens ämnen (inbyggda + egna). Returnerar true om något skrevs.
 */
export async function ensureSubjectInClass(data, cid, subjectId, subjects) {
  if (!subjectId || isBuiltinSubject(subjectId)) return false;
  const subject = subjects.find((s) => s.id === subjectId);
  // Okänt även i ursprungsklassen: där visas reservfärgen, och det gör det
  // i målklassen också — inget att kopiera.
  if (!subject?.color) return false;
  const path = classSettingsPath(cid);
  return data.once(path, SUBJECTS_DOC, (doc) => {
    const list = withSubject(doc?.value?.list, subject);
    if (!list) return null;
    return [{ path, doc: { ...(doc ?? {}), id: SUBJECTS_DOC, value: { ...(doc?.value ?? {}), list } } }];
  }, { allowLocal: true });
}

const normName = (s) => String(s ?? "").trim().toLocaleLowerCase("sv");

/**
 * Kopiorna som krockar med en av MINA planeringar i målklassen: samma namn
 * (utan hänsyn till skiftläge/mellanslag) samma datum. Varnar bara —
 * blockerar aldrig.
 */
export function findDuplicates(targetPlans, copies, uid = currentUid()) {
  const mine = (targetPlans ?? []).filter((p) => (p.ownerUid ?? uid) === uid);
  return copies.filter((c) => mine.some((p) => p.date === c.date && normName(p.name) === normName(c.name)));
}

/**
 * Lås målklassens elevskärmsförval (se huvudkommentaren). Finns
 * settings/lektion redan rörs det inte. Bara mot SERVERNS version (eller
 * lokalt läge) — inte allowLocal: offline på en dator där målklassen aldrig
 * öppnats saknas dokumentet i cachen även om läraren valt något på en annan
 * dator, och en köad låsning skulle då skriva över det valet (elevskärmen
 * kunde bli tom). Offline hoppas låsningen hellre över.
 */
async function pinTargetDefault(data, cid, now) {
  const path = lessonSettingsPath(cid);
  const plans = await data.list(plansPath(cid));
  await data.once(path, LESSON_SETTINGS_DOC, (doc) => doc ? null : [{
    path,
    doc: { id: LESSON_SETTINGS_DOC, value: { presentedPlanId: presentedPlanOf(plans, null, now)?.id ?? null } },
  }]);
}

/**
 * Skicka färdiga kopior (buildCopy) till målklassen. `subjects` =
 * ursprungsklassens ämnen. Returnerar kopiornas nya id:n i samma ordning.
 */
export async function sendPlanCopies(data, { targetCid, copies, subjects, now = Date.now() }) {
  for (const id of new Set(copies.map((c) => c.subjectId))) {
    await ensureSubjectInClass(data, targetCid, id, subjects);
  }
  await pinTargetDefault(data, targetCid, now);
  const ids = [];
  for (const c of copies) ids.push(await data.put(plansPath(targetCid, c.ownerUid), c));
  return ids;
}
