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
 *   group     "classroom" — Rutiner: kan visas för eleverna, står alltid
 *                           i menyraden med ikon + kort namn.
 *             "tools"     — Verktyg ▾ (issue #52): rullgardin med klassrums-
 *                           verktygen. Kan också visas för eleverna —
 *                           gruppen påverkar BARA menyn.
 *             "teacher"   — Lärare ▾: rullgardinen, ALDRIG elevskärmen.
 *   short     kort namn i menyn (valfritt; annars modulens title).
 *   priority  (classroom) lägre = viktigare. När inte ens ikonerna ryms
 *             flyttas de med HÖGST värde först till "Mer ▾".
 *
 * Ordningen i MODES ÄR menyordningen inom varje grupp, och kortkommandona
 * numrerar rutinerna först, sedan verktygen och sist lärarlägena (1, 2, 3 …).
 * Ett nytt läge (t.ex. Tankekarta) läggs alltså bara in här på rätt plats
 * med sin grupp (`group: "tools"`) — menykoden behöver inte röras.
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
  // ---- Rutiner (menyraden; kan visas på elevskärmen) ----
  entry(morgon, { group: "classroom", short: "Morgon", priority: 1 }),
  entry(lektion, { group: "classroom", short: "Lektion", priority: 2 }),
  entry(trafikljus, { group: "classroom", short: "Trafikljus", priority: 3 }),
  entry(vecka, { group: "classroom", short: "Veckan", priority: 9 }),
  // ---- Verktyg ▾ (kan visas på elevskärmen) ----
  entry(skriv, { group: "tools", short: "Skrivtavla" }),
  entry(lotta, { group: "tools", short: "Lottning" }),
  // ---- Lärare ▾ (aldrig på elevskärmen) ----
  entry(elever, { group: "teacher", short: "Elevlista" }),
  entry(oversikt, { group: "teacher", short: "Översikt" }),
];

export const DEFAULT_MODE_ID = MODES[0].id;

/** Lägena i en grupp, i menyordning. */
export const modesInGroup = (group) => MODES.filter((m) => m.group === group);

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
