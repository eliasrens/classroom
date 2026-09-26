/**
 * TEST — morgonskärmens bakgrunder (issue #64).
 *
 *   node docs/test-backgrounds.mjs
 *
 * Rena funktioner i js/lib/backgrounds.js med egna tidpunkter — ingen
 * falsk klocka och ingen Firestore. Körs i svensk tid (TZ sätts nedan).
 * Kontrollerar:
 *   - katalogen: fem kategorier, 8–14 bilder var, unika id:n, alt-text,
 *     inga Unsplash+-bilder, platserna har etikett
 *   - årstid efter datum (höst sep–nov, vinter dec–feb, vår mar–maj,
 *     sommar jun–aug), även runt midnatt vid månadsskiftet
 *   - slumpen tar bara årstidens bilder (aldrig Platser/egna) och byter bild
 *   - "manuellt val gäller i dag": ingen automatisk slump samma dag,
 *     ny slump nästa dag
 *   - saveBackground({ auto }) skriver inte över dagens manuella val i
 *     senaste versionen av dokumentet
 */

process.env.TZ = "Europe/Stockholm";

const {
  BG_CATEGORIES, UNSPLASH_IDS, unsplashUrl, thumbUrl, seasonFor, categoryUrls, findImage,
  pickSeasonBg, dayKey, pickedToday, shouldAutoRandomize,
} = await import("../js/lib/backgrounds.js");
const { normalize, saveBackground, MORNING_KEY } = await import("../js/lib/morning.js");

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

// Lokal tid (Europe/Stockholm). Månad 1-baserad för läsbarhet.
const at = (y, mo, d, h = 8, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();

// ---- Katalogen ----
{
  eq(BG_CATEGORIES.map((c) => c.id), ["host", "vinter", "var", "sommar", "platser"], "kategorierna i flikordning");
  for (const c of BG_CATEGORIES) {
    ok(c.images.length >= 8 && c.images.length <= 14, `${c.label}: 8–14 bilder (har ${c.images.length})`);
    for (const img of c.images) {
      ok(/^\d{9,13}-[0-9a-f]{12}$/.test(img.id), `${c.label}: id-format ${img.id}`);
      ok(img.alt && img.alt.length > 3, `${c.label}: alt-text för ${img.id}`);
      if (c.id === "platser") ok(img.place, `Platser: etikett för ${img.id}`);
    }
  }
  eq(new Set(UNSPLASH_IDS).size, UNSPLASH_IDS.length, "inga dubbletter i katalogen");
  ok(UNSPLASH_IDS.every((id) => !unsplashUrl(id).includes("plus.unsplash.com")), "bara images.unsplash.com (inga Unsplash+)");
  // De tio ursprungliga bilderna finns kvar, insorterade i en kategori.
  const original = [
    "1506905925346-21bda4d32df4", "1470071459604-3b5ec3a7fe05", "1441974231531-c6227db76b6e",
    "1501785888041-af3ef285b470", "1472214103451-9374bd1c798e", "1447752875215-b2761acb3c5d",
    "1518495973542-4542c06a5843", "1439066615861-d1af74d74000", "1426604966848-d7adac402bff",
    "1469474968028-56623f02e42e",
  ];
  ok(original.every((id) => UNSPLASH_IDS.includes(id)), "de tio gamla bilderna är insorterade");
  const wonders = ["Kinesiska muren", "Petra", "Colosseum", "Chichén Itzá", "Machu Picchu", "Taj Mahal", "Kristusstatyn"];
  const places = BG_CATEGORIES.find((c) => c.id === "platser").images.map((i) => i.place);
  ok(wonders.every((w) => places.includes(w)), "Platser i världen har de sju nya underverken");
  eq(thumbUrl(unsplashUrl("1552832230-c0197dd311b5")),
    "https://images.unsplash.com/photo-1552832230-c0197dd311b5?auto=format&fit=crop&w=320&q=60", "miniatyr-URL");
  eq(thumbUrl("data:image/png;base64,AAAA"), "data:image/png;base64,AAAA", "egen bild: ingen miniatyr-omskrivning");
  eq(findImage(unsplashUrl("1552832230-c0197dd311b5"))?.category, "platser", "findImage hittar kategorin");
  eq(findImage("https://example.com/x.jpg"), null, "findImage: egen bild → null");
}

// ---- Årstid efter datum ----
{
  const cases = [
    [1, "vinter"], [2, "vinter"], [3, "var"], [4, "var"], [5, "var"], [6, "sommar"],
    [7, "sommar"], [8, "sommar"], [9, "host"], [10, "host"], [11, "host"], [12, "vinter"],
  ];
  for (const [m, s] of cases) eq(seasonFor(at(2026, m, 15)), s, `årstid i månad ${m}`);
  eq(seasonFor(at(2026, 8, 31, 23, 59)), "sommar", "31 aug 23:59 = sommar");
  eq(seasonFor(at(2026, 9, 1, 0, 0)), "host", "1 sep 00:00 = höst (lokal tid, inte UTC)");
  eq(seasonFor(at(2026, 11, 30, 23, 59)), "host", "30 nov 23:59 = höst");
  eq(seasonFor(at(2026, 12, 1, 0, 0)), "vinter", "1 dec 00:00 = vinter");
  eq(seasonFor(at(2026, 9, 26)), "host", "i dag (26 sep 2026) = höst");
}

// ---- Slumpen tar bara årstidens bilder ----
{
  const now = at(2026, 9, 26);
  const host = categoryUrls("host");
  const places = new Set(categoryUrls("platser"));
  // Deterministiska "slumptal" över hela intervallet.
  for (let k = 0; k < 200; k++) {
    const r = k / 200;
    const url = pickSeasonBg("", now, () => r);
    ok(host.includes(url), `slump ${k}: höstbild`);
    ok(!places.has(url), `slump ${k}: aldrig Platser i världen`);
  }
  // Riktig Math.random, många dragningar.
  const seen = new Set();
  for (let k = 0; k < 2000; k++) seen.add(pickSeasonBg("", now));
  ok([...seen].every((u) => host.includes(u)), "Math.random: bara höstbilder");
  eq(seen.size, host.length, "Math.random: alla höstbilder kan komma");
  // Byter alltid bild
  for (const cur of host) ok(pickSeasonBg(cur, now, () => 0.5) !== cur, "Slumpa byter bild");
  // Egen bild/plats som nuvarande → ändå en höstbild
  ok(host.includes(pickSeasonBg("data:image/png;base64,AAAA", now)), "egen bild nu → höstbild");
  // Andra årstider
  ok(categoryUrls("vinter").includes(pickSeasonBg("", at(2027, 1, 10))), "januari → vinterbild");
  ok(categoryUrls("var").includes(pickSeasonBg("", at(2027, 4, 10))), "april → vårbild");
  ok(categoryUrls("sommar").includes(pickSeasonBg("", at(2027, 7, 10))), "juli → sommarbild");
}

// ---- Manuellt val gäller i dag ----
{
  const mon = at(2026, 9, 28, 8);
  const monEvening = at(2026, 9, 28, 23, 59);
  const tue = at(2026, 9, 29, 0, 1);
  eq(dayKey(mon), "2026-09-28", "dayKey = lokalt datum");
  eq(dayKey(at(2026, 9, 28, 0, 30)), "2026-09-28", "dayKey strax efter midnatt (UTC är fortfarande 27:e)");
  const picked = { current: unsplashUrl("1552832230-c0197dd311b5"), pickedOn: "2026-09-28" };
  ok(pickedToday(picked, mon), "valt i dag");
  ok(pickedToday(picked, monEvening), "valt i dag — även på kvällen");
  ok(!pickedToday(picked, tue), "nästa dag gäller valet inte längre");
  ok(!pickedToday({ current: "", pickedOn: "2026-09-28" }, mon), "utan bild finns inget val");

  eq(shouldAutoRandomize(picked, { firstInSession: true }, mon), false, "omladdning samma dag: ingen slump");
  eq(shouldAutoRandomize(picked, { firstInSession: true }, tue), true, "ny dag: slumpa ny årstidsbild");
  eq(shouldAutoRandomize({ current: picked.current, pickedOn: "" }, { firstInSession: true }, mon), true, "inget manuellt val: slumpa vid sidladdning");
  eq(shouldAutoRandomize({ current: picked.current, pickedOn: "" }, { firstInSession: false }, mon), false, "samma session: stabil bild");
  eq(shouldAutoRandomize({ current: "", pickedOn: "" }, { firstInSession: false }, mon), true, "ingen bild alls: slumpa");

  eq(normalize(null).background.pickedOn, "", "normalize: pickedOn saknas → tom");
  eq(normalize({ background: { current: "x", pickedOn: "2026-09-28" } }).background.pickedOn, "2026-09-28", "normalize behåller pickedOn");
  eq(normalize({ background: { pickedOn: 5 } }).background.pickedOn, "", "normalize: fel typ → tom");
}

// ---- saveBackground({ auto }) mot senaste versionen ----
{
  // Minimal fejk av datalagrets once(): kör transaktionsfunktionen mot
  // "senaste versionen" och applicera det den returnerar.
  function fakeData(value) {
    const store = { doc: value == null ? null : { id: MORNING_KEY, value } };
    return {
      store,
      async once(_path, _id, fn) {
        const ops = fn(store.doc ? structuredClone(store.doc) : null);
        if (ops) for (const op of ops) store.doc = op.doc;
      },
    };
  }
  const mon = at(2026, 9, 28, 8);
  const chosen = unsplashUrl("1552832230-c0197dd311b5");
  const random = categoryUrls("host")[0];

  const d1 = fakeData({ background: { current: chosen, extraUrls: [], pickedOn: "2026-09-28" } });
  await saveBackground(d1, "c1", random, { auto: true, now: mon });
  eq(d1.store.doc.value.background.current, chosen, "auto-slump skriver inte över dagens manuella val");

  const d2 = fakeData({ background: { current: chosen, extraUrls: [], pickedOn: "2026-09-27" } });
  await saveBackground(d2, "c1", random, { auto: true, now: mon });
  eq(d2.store.doc.value.background, { current: random, extraUrls: [], pickedOn: "" }, "gårdagens val: ny slump, pickedOn nollställs");

  const d3 = fakeData({ background: { current: chosen, extraUrls: [] }, praise: [{ kind: "free", text: "x" }], weekOf: "2026-W39" });
  await saveBackground(d3, "c1", random, { auto: true, now: mon });
  ok(!("praise" in d3.store.doc.value) && !("weekOf" in d3.store.doc.value), "Bra jobbat skickas aldrig till molnet (#32)");

  const d4 = fakeData(null);
  await saveBackground(d4, "c1", random, { auto: true, now: mon });
  eq(d4.store.doc.value.background.current, random, "tomt dokument: slumpen sparas");
}

console.log(`${passed} ok, ${failed} fel`);
if (failed) process.exit(1);
