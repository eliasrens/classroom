/**
 * TEST — utfällbara sektioner i lärarpanelerna (issue #66).
 *
 *   node docs/test-collapsible.mjs
 *
 * Rena delar av js/ui/collapsible.js utan webbläsare:
 *   - lead/trail (issue #72): kontroller i rubrikraden före/efter knappen
 *   - collapsibleHTML: knapp med aria-expanded/aria-controls som pekar på
 *     innehållets id, rubrik och sammanfattningsplats, persist-flaggan
 *   - firstWords: "tomt" för tomt fält, hela texten när den är kort,
 *     avkortad vid ordgräns med … när den är lång
 * Beteendet i webbläsaren (klick, tangentbord, localStorage, omladdning)
 * verifieras i headless Chrome, se docs/screenshots/issue-66.
 */

const { collapsibleHTML, firstWords } = await import("../js/ui/collapsible.js");

let failed = 0;
let passed = 0;
function eq(actual, expected, msg) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed++; return; }
  failed++;
  console.error(`FEL: ${msg}\n   fick     ${a}\n   väntade  ${e}`);
}
const ok = (cond, msg) => eq(!!cond, true, msg);

// ---- Markup ----
{
  const html = collapsibleHTML({ key: "tasks", title: "Att göra", body: "<p>x</p>" });
  const controls = /aria-controls="([^"]+)"/.exec(html)?.[1];
  ok(controls, "rubrikknappen har aria-controls");
  ok(html.includes(`id="${controls}"`), "aria-controls pekar på innehållets id");
  ok(/<button type="button" class="collapsible__head"[^>]*aria-expanded="false"/.test(html), "knappen startar med aria-expanded=false");
  ok(html.includes('data-collapsible="tasks"'), "nyckeln finns på sektionen");
  ok(html.includes("data-summary"), "plats för sammanfattning");
  ok(html.includes("<p>x</p>"), "innehållet finns med");
  ok(!html.includes("data-persist"), "sparas som standard");
  ok(/<h3 class="collapsible__heading">/.test(html), "rubriknivå 3 som standard");
  const other = collapsibleHTML({ key: "tasks", title: "Att göra" });
  ok(/aria-controls="([^"]+)"/.exec(other)[1] !== controls, "unika id:n per sektion");
  const noPersist = collapsibleHTML({ key: "field-vad", title: "Vad", persist: false, level: 2 });
  ok(noPersist.includes('data-persist="false"'), "persist:false markeras");
  ok(/<h2 class="collapsible__heading">/.test(noPersist), "rubriknivå kan väljas");
  ok(collapsibleHTML({ key: 'a"b', title: "t" }).includes('data-collapsible="a&quot;b"'), "nyckeln escapas");
  ok(!html.includes("collapsible__heading--row"), "vanlig rubrik utan extra kontroller");
  // lead/trail (issue #72): kontroller i rubrikraden, UTANFÖR knappen
  const row = collapsibleHTML({ key: "week:2026-09-21", title: "Vecka 39", lead: '<input type="checkbox" data-week>', trail: '<button class="ca-add">x</button>' });
  ok(row.includes("collapsible__heading--row"), "rubrikraden blir flexrad med lead/trail");
  ok(/<input type="checkbox" data-week>\s*<button type="button" class="collapsible__head"/.test(row), "lead ligger före knappen");
  ok(/<\/button><button class="ca-add">x<\/button>/.test(row), "trail ligger efter knappen");
}

// ---- firstWords ----
{
  eq(firstWords(""), "tomt", "tomt fält");
  eq(firstWords("   \n  "), "tomt", "bara blanksteg");
  eq(firstWords(null), "tomt", "null");
  eq(firstWords("Bråk"), "Bråk", "kort text oförändrad");
  eq(firstWords("Läs sid 12\nGör uppgift 1-5"), "Läs sid 12 Gör uppgift 1-5", "radbrytningar blir mellanslag");
  const long = firstWords("Vi arbetar två och två med bråkstavar och diskuterar vad som händer");
  ok(long.endsWith("…"), "lång text avslutas med …");
  ok(long.length <= 43, "lång text avkortas");
  eq(long, "Vi arbetar två och två med bråkstavar och…", "avkortas vid ordgräns");
  eq(firstWords("a".repeat(60), 10), "aaaaaaaaaa…", "ord utan mellanslag kapas hårt");
}

console.log(`${passed} ok, ${failed} fel`);
if (failed) process.exit(1);
