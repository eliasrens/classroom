/**
 * LÄGESREGISTRET — lägena i MENYORDNING (issue #45).
 *
 * Varje läge är en modul i js/modes/ som default-exporterar ett
 * objekt enligt docs/MODULKONTRAKT.md. Registret är den enda plats
 * som behöver ändras när ett läge läggs till — övermenyn
 * (js/ui/mode-nav.js), kortkommandona (js/ui/shortcuts.js), hjälpen
 * (js/ui/help.js) och spärren för elevskärmen läses härifrån.
 *
 * Varje post i MODES anger:
 *   group     "classroom" — Rutiner (Morgon, Lektion). Kan visas för eleverna.
 *             "tools"     — Verktyg (issue #52). Kan också visas för eleverna.
 *             "teacher"   — Lärare ▾: rullgardinen, ALDRIG elevskärmen.
 *             Rutiner och verktyg listas under "Verktyg ▾" (två rubriker);
 *             varje lärare fäster själv vilka av dem som står direkt i
 *             övermenyn (js/lib/menu-pins.js). Gruppen påverkar BARA menyn.
 *   short     kort namn i övermenyn (valfritt; annars modulens title).
 *   order     ordning inom gruppen (valfritt; lägre först, annars
 *             ordningen i MODES). Verktygen har luckor (10, 20, 40 …) så
 *             att ett nytt verktyg kan läggas mellan två andra.
 *
 * Kortkommandona numrerar rutinerna först, sedan verktygen och sist
 * lärarlägena (1, 2, 3 …), var grupp i sin ordning — oberoende av vad som
 * är fäst. Ett nytt läge läggs alltså bara in här med sin grupp och
 * ordning — menyn, siffrorna och hjälpen följer med av sig själva.
 * Tankekarta (#53) får `group: "tools", order: 30` och hamnar mellan
 * Skrivtavla och Lottning. Ett nytt verktyg är inte fäst från början.
 */
import morgon from "./morgon.js";
import lektion from "./lektion.js";
import trafikljus from "./trafikljus.js";
import elever from "./elever.js";
import oversikt from "./oversikt.js";
import vecka from "./vecka.js";
import skriv from "./skriv.js";
import lotta from "./lotta.js";

export const NAV_GROUPS = {
  classroom: { label: "Rutiner" },
  tools: { label: "Verktyg" },
  teacher: { label: "Lärare" },
};

const entry = (mod, meta) => Object.assign(mod, meta);

export const MODES = [
  // ---- Rutiner (kan visas på elevskärmen) ----
  entry(morgon, { group: "classroom", short: "Morgon" }),
  entry(lektion, { group: "classroom", short: "Lektion" }),
  // ---- Verktyg (kan visas på elevskärmen). order 30 = Tankekarta (#53). ----
  entry(trafikljus, { group: "tools", short: "Trafikljus", order: 10 }),
  entry(skriv, { group: "tools", short: "Skrivtavla", order: 20 }),
  entry(lotta, { group: "tools", short: "Lottning", order: 40 }),
  entry(vecka, { group: "tools", short: "Veckan", order: 50 }),
  // ---- Lärare ▾ (aldrig på elevskärmen) ----
  entry(elever, { group: "teacher", short: "Elevlista" }),
  entry(oversikt, { group: "teacher", short: "Översikt" }),
];

export const DEFAULT_MODE_ID = MODES[0].id;

/** Lägena i en grupp, i menyordning (`order`, annars ordningen i MODES). */
export const modesInGroup = (group) =>
  MODES.filter((m) => m.group === group).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

/** Grupperna i menyordning — samma ordning som i övermenyn. */
export const NAV_GROUP_ORDER = ["classroom", "tools", "teacher"];

/** Grupperna vars lägen får visas på elevskärmen. */
const STUDENT_GROUPS = ["classroom", "tools"];

/**
 * Menyordningen som kortkommandona numrerar: rutinerna först, sedan
 * verktygen och sist lärarlägena (oavsett hur de ligger blandade i MODES).
 */
export const navOrder = () => NAV_GROUP_ORDER.flatMap(modesInGroup);

/** Kort namn för menyn. */
export const shortTitle = (m) => m.short ?? m.title;

/**
 * GAMLA ADRESSER som leder till ett läge + en flik. Statistik slogs ihop
 * med Översikt (issue #45): #/statistik → #/oversikt/veckor.
 */
export const MODE_ALIASES = {
  statistik: { modeId: "oversikt", sub: "veckor" },
};

/**
 * SPÄRR: de enda lägen som får renderas på elevskärmen = grupperna
 * "Rutiner" (classroom) och "Verktyg" (tools). Elevlista och Översikt (noteringar, lärarpaneler)
 * står i "Lärare"-gruppen och får ALDRIG nå elevvyn — routern vägrar
 * montera dem där och elevskärmen följer aldrig med dit. Ett läge som
 * läggs i "classroom" eller "tools" MÅSTE alltså rendera en elevsäker vy för
 * ctx.view === "student".
 * "vecka" (Veckans övergångar) visar bara passens tider och färger — inga
 * lärarnamn, noteringar eller elevdata (se js/lib/week-recap.js).
 * "skriv" (Skrivtavla) visar bara texten läraren själv skriver, på papperet.
 * "lotta" (Lottning) visar bara hjulet/rullen/lappen och resultatet — aldrig
 * listorna, frånvaron eller "Redan dragna".
 */
export const STUDENT_MODE_IDS = Object.freeze(
  MODES.filter((m) => STUDENT_GROUPS.includes(m.group)).map((m) => m.id));

export const isStudentMode = (id) => STUDENT_MODE_IDS.includes(id);

export function getMode(id) {
  return MODES.find((m) => m.id === id) ?? null;
}
